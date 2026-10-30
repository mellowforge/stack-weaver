// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toData } from '../../src/document/data.js';
import { DocumentStore } from '../../src/document/store.js';
import type { YamlValue } from '../../src/document/types.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { createWidgetContext } from '../../src/visual/widgets/context.js';
import { defaultWidgets } from '../../src/visual/widgets/registry.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const host = document.createElement('div');
document.body.append(host);
afterEach(() => {
  host.replaceChildren();
  vi.restoreAllMocks();
});

const SECRET = `apiVersion: v1
kind: Secret
metadata:
  name: db
data:
  password: cGFzc3fDtnJk
  token: dG9rZW4=
`;

const dataOf = (store: DocumentStore): Record<string, YamlValue> => ((toData(store.parsed, 0) as { data?: Record<string, YamlValue> }).data ?? {}) as Record<string, YamlValue>;

function mount(text: string, readOnly = false) {
  const store = new DocumentStore(text);
  const ctx = createWidgetContext(store, {
    id: 'w1',
    label: 'Data',
    description: '',
    ref: { doc: 0, path: ['data'] },
    value: dataOf(store),
    schema: { type: 'object', additionalProperties: { type: 'string', format: 'byte' } },
    readOnly,
    messages: defaultUiMessages,
  });
  const w = defaultWidgets['secret-data']!(ctx);
  host.append(w.el);
  const input = (name: string) => w.el.querySelector<HTMLTextAreaElement>(`[data-sw-entry="${name}"]`)!;
  return { store, w, input, refresh: () => w.update(dataOf(store), readOnly) };
}
const type = (input: HTMLTextAreaElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('secret-data widget', () => {
  it('secret-data shows decoded UTF-8 values', () => {
    const { input, w } = mount(SECRET);
    expect(input('password').value).toBe('passwörd');
    expect(input('token').value).toBe('token');
    expect(w.el.querySelector('.sw-field-warning')?.textContent ?? '').toBe('');
    expect(input('password').getAttribute('aria-label')).toBe('Data, password, Value');
  });

  it('editing re-encodes base64', () => {
    const { store, input, refresh } = mount(SECRET);
    type(input('password'), 'pässwörd €');
    expect(dataOf(store)['password']).toBe(btoa(String.fromCharCode(...new TextEncoder().encode('pässwörd €'))));
    expect(store.text).toContain('password: cMOkc3N3w7ZyZCDigqw=');
    expect(dataOf(store)['token']).toBe('dG9rZW4='); // untouched
    refresh();
    expect(input('password').value).toBe('pässwörd €'); // still what the user typed
    type(input('password'), '');
    expect(dataOf(store)['password']).toBe('');
  });

  it('invalid base64 shows the raw value read-only with a warning', () => {
    const { store, input, w } = mount(SECRET.replace('dG9rZW4=', 'not base64!!'));
    const bad = input('token');
    expect(bad.value).toBe('not base64!!');
    expect(bad.readOnly).toBe(true);
    const warning = bad.closest('.sw-secret-entry')!.querySelector('.sw-field-warning')!;
    expect(w.el.querySelectorAll('.sw-field-warning:not([hidden])')).toHaveLength(1);
    expect(warning.textContent).toBe(defaultUiMessages.secretInvalidBase64);
    expect(bad.getAttribute('aria-describedby')).toContain(warning.id);
    expect(input('password').readOnly).toBe(false); // other keys stay editable
    type(bad, 'changed');
    expect(dataOf(store)['token']).toBe('not base64!!');
  });

  it('valid base64 of non-UTF-8 bytes is also shown raw and read-only', () => {
    const { input } = mount(SECRET.replace('dG9rZW4=', '/w=='));
    expect(input('token').value).toBe('/w==');
    expect(input('token').readOnly).toBe(true);
  });

  it('a value that is not a string is raw and read-only', () => {
    const { input } = mount(SECRET.replace('dG9rZW4=', '42'));
    expect(input('token').value).toBe('42');
    expect(input('token').readOnly).toBe(true);
  });

  it('has no Add key input of its own, but keys can be removed', () => {
    const { store, w } = mount(SECRET);
    expect(w.el.querySelector('.sw-list-add, .sw-add-key')).toBeNull();
    w.el.querySelector<HTMLButtonElement>('.sw-list-remove')!.click();
    expect(Object.keys(dataOf(store))).toEqual(['token']);
  });

  it('is disabled while read-only', () => {
    const { w } = mount(SECRET, true);
    for (const i of w.el.querySelectorAll('input, button')) expect((i as HTMLTextAreaElement).disabled).toBe(true);
  });
});

describe('secret-data with multi-line text', () => {
  const PEM = '-----BEGIN CERTIFICATE-----\nMIIBkTCB+wIJAL\nabc==\n-----END CERTIFICATE-----\n';
  const b64 = (t: string) => btoa(String.fromCharCode(...new TextEncoder().encode(t)));

  it('keeps line breaks and round-trips unchanged except for the edit', () => {
    const { store, input } = mount(SECRET.replace('dG9rZW4=', b64(PEM)));
    const area = input('token');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe(PEM);
    expect(Number(area.getAttribute('rows'))).toBeGreaterThan(1);
    const edited = PEM.replace('MIIBkTCB', 'MIIBkTCX');
    type(area, edited);
    expect(dataOf(store)['token']).toBe(b64(edited));
    expect(new TextDecoder().decode(Uint8Array.from(atob(dataOf(store)['token'] as string), (c) => c.charCodeAt(0)))).toBe(edited);
    expect(dataOf(store)['password']).toBe('cGFzc3fDtnJk'); // other keys are untouched
  });

  it('text with a carriage return is shown read-only with a warning, not rewritten', () => {
    const { store, input, w } = mount(SECRET.replace('dG9rZW4=', b64('a\r\nb')));
    expect(input('token').readOnly).toBe(true);
    expect(w.el.textContent).toContain(defaultUiMessages.secretCarriageReturn);
    type(input('token'), 'x');
    expect(dataOf(store)['token']).toBe(b64('a\r\nb'));
  });
});

describe('Add key suppression is declared by the widget', () => {
  it('a free-form map with guide widget key-value still offers Add key', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const guide = { kubernetes: { fields: { 'io.k8s.api.core.v1.Secret#stringData': { widget: 'key-value' } } } };
    const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: SECRET + 'stringData:\n  a: b\n', guide });
    await made.editor.ready;
    await made.ctx.loadBundle(0);
    made.ctx.select({ doc: 0, path: ['stringData'] });
    await vi.waitFor(() => expect(el.querySelector('.sw-row[data-sw-key="a"]')).not.toBeNull());
    expect(el.querySelector('.sw-add-key-btn')).not.toBeNull();
    el.remove();
  });

  it('only factories that declare managesKeys suppress it', () => {
    expect(defaultWidgets['secret-data']!.managesKeys).toBe(true);
    expect(defaultWidgets['key-value']!.managesKeys).toBeUndefined();
  });
});

describe('Secret in the visual pane', () => {
  it('secret-data has no Add key; the Secret section offers stringData', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: SECRET });
    await made.editor.ready;
    await made.ctx.loadBundle(0);

    made.ctx.select({ doc: 0, path: [] });
    await vi.waitFor(() => expect(el.querySelector('.sw-section')).not.toBeNull());
    const group = el.querySelector('.sw-add-group[data-sw-tier="recommended"]')!;
    expect(group.querySelector('[data-sw-add="stringData"]')).not.toBeNull();
    // The data row is the Secret widget, not a plain key-value editor.
    const row = el.querySelector<HTMLElement>('.sw-row[data-sw-key="data"]')!;
    expect(row.querySelector('.sw-widget-secret-data')).not.toBeNull();
    expect(row.querySelector<HTMLTextAreaElement>('[data-sw-entry="password"]')!.value).toBe('passwörd');

    // Opening `data` as a section does not give it an "Add key" either.
    made.ctx.select({ doc: 0, path: ['data'] });
    // The `password` row exists only in the data section, so the root section is gone when this passes.
    await vi.waitFor(() => expect(el.querySelector('.sw-row[data-sw-key="password"]')).not.toBeNull());
    expect(el.querySelector('.sw-row[data-sw-key="apiVersion"]')).toBeNull();
    expect(el.querySelector('.sw-add-key-btn')).toBeNull();
    el.remove();
  });

  it('stringData still gets Add key (plain key-value widget)', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: SECRET + 'stringData:\n  a: b\n' });
    await made.editor.ready;
    await made.ctx.loadBundle(0);
    made.ctx.select({ doc: 0, path: ['stringData'] });
    await vi.waitFor(() => expect(el.querySelector('.sw-add-key-btn')).not.toBeNull());
    el.remove();
  });
});
