// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toData } from '../../src/document/data.js';
import { DocumentStore } from '../../src/document/store.js';
import type { YamlPath, YamlValue } from '../../src/document/types.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { resolveAt } from '../../src/engine/resolve.js';
import type { ResolvedSchema } from '../../src/engine/resolve.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { JsonSchema } from '../../src/formats/types.js';
import { createWidgetContext } from '../../src/visual/widgets/context.js';
import { defaultWidgets, pickWidget } from '../../src/visual/widgets/registry.js';

const host = document.createElement('div');
document.body.append(host);
afterEach(() => {
  host.replaceChildren();
  vi.restoreAllMocks();
});

const QUANTITY: JsonSchema = {
  anyOf: [{ type: 'string', pattern: '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+|[numkMGTPE]i?|[KMGTPE]i)?$' }, { type: 'number' }],
};
const INT_OR_STRING: JsonSchema = { anyOf: [{ type: 'integer' }, { type: 'string' }] };
const STRING_MAP: JsonSchema = { type: 'object', additionalProperties: { type: 'string' } };
const STRING_ARRAY: JsonSchema = { type: 'array', items: { type: 'string' } };

const resolved = (schema: JsonSchema): ResolvedSchema => ({ schema, required: [] });

describe('pickWidget options', () => {
  it('options give a suggestion widget', () => {
    const opts = { options: ['Always', 'Never'] };
    expect(pickWidget(resolved({ type: 'string' }), opts, defaultWidgets)).toEqual({ name: 'suggest' });
    expect(pickWidget(resolved({ type: ['string', 'null'] }), opts, defaultWidgets)).toEqual({ name: 'suggest' });
    // An explicit guide widget wins over options.
    expect(pickWidget(resolved({ type: 'string' }), { ...opts, widget: 'quantity' }, defaultWidgets)).toEqual({ name: 'quantity' });
    // Options win over the schema shape for strings, but do not change other shapes.
    expect(pickWidget(resolved({ type: 'integer' }), opts, defaultWidgets)).toEqual({ name: 'integer' });
    expect(pickWidget(resolved({ type: 'array', items: { type: 'string' } }), opts, defaultWidgets)).toEqual({ name: 'string-list' });
    expect(pickWidget(resolved({ type: 'string' }), { options: [] }, defaultWidgets)).toEqual({ name: 'string' });
  });

  it('suggest keeps free text and offers the options in a datalist', () => {
    const edits: unknown[] = [];
    const ctx = {
      id: 'f1', label: 'Pull policy', description: '', ref: { doc: 0, path: ['x'] }, value: 'Always', schema: { type: 'string' }, readOnly: false,
      options: ['Always', 'IfNotPresent', 'Never'], messages: defaultUiMessages, parsed: () => undefined as never,
      commit: (v: unknown) => (edits.push(v), undefined), edit: () => ({ ok: true }) as never,
    };
    const w = defaultWidgets['suggest']!(ctx as never);
    host.append(w.el);
    const input = w.el.querySelector<HTMLInputElement>('input')!;
    const list = w.el.querySelector('datalist')!;
    expect(input.id).toBe('f1');
    expect(input.getAttribute('list')).toBe(list.id);
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['Always', 'IfNotPresent', 'Never']);
    expect(input.value).toBe('Always');
    input.value = 'Custom';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edits).toEqual(['Custom']);
  });
});

describe('string-list suggestions', () => {
  it('a string list offers the guide options on its item inputs', () => {
    const store = new DocumentStore('a:\n  - ReadWriteOnce\n');
    const ctx = createWidgetContext(store, {
      id: 'w1', label: 'Modes', description: '', ref: { doc: 0, path: ['a'] }, value: ['ReadWriteOnce'], schema: STRING_ARRAY, readOnly: false,
      options: ['ReadWriteOnce', 'ReadOnlyMany'], messages: defaultUiMessages,
    });
    const w = defaultWidgets['string-list']!(ctx);
    host.append(w.el);
    const list = w.el.querySelector('datalist')!;
    expect([...list.querySelectorAll('option')].map((o) => o.value)).toEqual(['ReadWriteOnce', 'ReadOnlyMany']);
    for (const input of w.el.querySelectorAll('input')) expect(input.getAttribute('list')).toBe(list.id);
  });
});

describe('pickWidget', () => {
  it('pickWidget follows guide, then schema shape', async () => {
    const d = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const s = (await loadKubernetesKind('v1', 'Service'))!;
    const c: YamlPath = ['spec', 'template', 'spec', 'containers', 0];
    const at = (b: typeof d, p: YamlPath): ResolvedSchema => resolveAt(b, p, undefined)!;
    const name = (r: ResolvedSchema, guide?: { widget?: string }) => pickWidget(r, guide, defaultWidgets)?.name;

    expect(name(at(d, [...c, 'image']))).toBe('string');
    expect(name(at(d, [...c, 'imagePullPolicy']))).toBe('string'); // upstream has no enum here
    expect(name(at(d, [...c, 'ports', 0, 'containerPort']))).toBe('integer');
    expect(name(at(d, [...c, 'resources', 'limits', 'cpu']))).toBe('quantity');
    expect(name(at(s, ['spec', 'ports', 0, 'targetPort']))).toBe('int-or-string');
    expect(name(at(d, ['metadata', 'labels']))).toBe('key-value');
    expect(name(at(d, [...c, 'args']))).toBe('string-list');
    expect(name(at(d, ['spec', 'template']))).toBeUndefined(); // a nested section card
    expect(name(at(d, [...c, 'resources', 'limits']))).toBeUndefined(); // values are quantities, not strings

    expect(name(resolved({ enum: ['a', 'b'], type: 'string' }))).toBe('enum');
    expect(name(resolved({ type: 'boolean' }))).toBe('boolean');
    expect(name(resolved({ type: 'number' }))).toBe('number');
    expect(name(resolved({ type: ['string', 'null'] }))).toBe('string');
    // The guide wins, and carries a parameter.
    expect(pickWidget(resolved({ type: 'string' }), { widget: 'quantity' }, defaultWidgets)).toEqual({ name: 'quantity' });
    expect(pickWidget(resolved({ type: 'string' }), { widget: 'string-list:comma' }, defaultWidgets)).toEqual({ name: 'string-list', param: 'comma' });
  });

  it('unknown guide widget falls back to schema', () => {
    expect(pickWidget(resolved({ type: 'integer' }), { widget: 'no-such-widget' }, defaultWidgets)).toEqual({ name: 'integer' });
    expect(() => pickWidget(resolved({ type: 'integer' }), { widget: ':' }, defaultWidgets)).not.toThrow();
    expect(pickWidget(resolved({ type: 'integer' }), { widget: 'toString' }, defaultWidgets)).toEqual({ name: 'integer' });
    expect(pickWidget(resolved({ type: 'object' }), undefined, defaultWidgets)).toBeUndefined();
  });

  it('only names the registry has', () => {
    expect(pickWidget(resolved({ type: 'integer' }), undefined, {})).toBeUndefined();
    expect(pickWidget(resolved({ type: 'integer' }), { widget: 'mine' }, { mine: defaultWidgets['string']! })).toEqual({ name: 'mine' });
  });
});

function valueAt(store: DocumentStore, path: YamlPath): YamlValue {
  let cur: unknown = toData(store.parsed, 0);
  for (const seg of path) cur = (cur as Record<string | number, unknown> | undefined)?.[seg];
  return (cur ?? null) as YamlValue;
}

function setup(name: string, text: string, path: YamlPath, schema: JsonSchema, extra: { readOnly?: boolean; label?: string } = {}) {
  const store = new DocumentStore(text);
  const readOnly = extra.readOnly ?? false;
  const ctx = createWidgetContext(store, {
    id: 'w1',
    label: extra.label ?? 'Field',
    description: '',
    ref: { doc: 0, path },
    value: valueAt(store, path),
    schema,
    readOnly,
    messages: defaultUiMessages,
  });
  const w = defaultWidgets[name]!(ctx);
  const label = document.createElement('label');
  label.id = 'w1-label';
  label.htmlFor = 'w1';
  label.textContent = extra.label ?? 'Field';
  host.append(label, w.el);
  const refresh = () => w.update(valueAt(store, path), readOnly);
  refresh();
  return { store, w, refresh, data: () => toData(store.parsed, 0) as Record<string, unknown> };
}

const type = (input: HTMLInputElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const q = <T extends Element>(sel: string, root: ParentNode = host) => root.querySelector<T>(sel)!;
const qa = <T extends Element>(sel: string, root: ParentNode = host) => [...root.querySelectorAll<T>(sel)];

describe('text widgets', () => {
  it('number widget commits numbers, not strings', () => {
    const { store, w, data } = setup('number', 'a: 1\n', ['a'], { type: 'number' });
    const input = q<HTMLInputElement>('input', w.el);
    expect(input.value).toBe('1');
    type(input, '2.5');
    expect(store.text).toBe('a: 2.5\n');
    expect(data()['a']).toBe(2.5);
    type(input, '10');
    expect(data()['a']).toBe(10);
    expect(typeof data()['a']).toBe('number');
    type(input, '1e'); // not a number yet: nothing committed, flagged
    expect(store.text).toBe('a: 10\n');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('integer widget refuses a fraction', () => {
    const { store, w } = setup('integer', 'a: 1\n', ['a'], { type: 'integer' });
    const input = q<HTMLInputElement>('input', w.el);
    type(input, '2.5');
    expect(store.text).toBe('a: 1\n');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    type(input, '7');
    expect(store.text).toBe('a: 7\n');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('int-or-string commits 8080 as number and http as string', () => {
    const { store, w, data } = setup('int-or-string', 'port: http\n', ['port'], INT_OR_STRING);
    const input = q<HTMLInputElement>('input', w.el);
    expect(input.value).toBe('http');
    type(input, '8080');
    expect(data()['port']).toBe(8080);
    type(input, 'http');
    expect(data()['port']).toBe('http');
    expect(store.text).toBe('port: http\n');
  });

  it('quantity widget flags an invalid value inline without committing', () => {
    const { store, w, data } = setup('quantity', 'cpu: 100m\n', ['cpu'], QUANTITY);
    const input = q<HTMLInputElement>('input', w.el);
    type(input, 'lots');
    expect(store.text).toBe('cpu: 100m\n');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const err = q<HTMLElement>('.sw-field-error', w.el);
    expect(err.textContent).not.toBe('');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
    type(input, '500m');
    expect(data()['cpu']).toBe('500m');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(err.textContent).toBe('');
    type(input, '2');
    expect(data()['cpu']).toBe(2); // a plain number stays a number
  });

  it('typing commits per keystroke with one undo group', () => {
    const { store, w } = setup('string', 'name: a\n', ['name'], { type: 'string' });
    const edit = vi.spyOn(store, 'edit');
    const input = q<HTMLInputElement>('input', w.el);
    type(input, 'ab');
    type(input, 'abc');
    type(input, 'abcd');
    expect(edit).toHaveBeenCalledTimes(3);
    expect(edit.mock.calls.map((c) => c[1])).toEqual(Array(3).fill({ group: 'visual:0:name' }));
    expect(store.text).toBe('name: abcd\n');
    store.undo();
    expect(store.text).toBe('name: a\n');
    expect(store.canUndo).toBe(false);
  });

  it('update does not clobber the focused input caret', () => {
    const { store, w, refresh } = setup('string', 'name: abc\n', ['name'], { type: 'string' });
    const input = q<HTMLInputElement>('input', w.el);
    input.focus();
    expect(document.activeElement).toBe(input);
    input.setSelectionRange(1, 1);
    refresh();
    expect(input.selectionStart).toBe(1);
    // typing a number prefix that normalises differently ("1." parses as 1) keeps the text too
    const n = setup('number', 'n: 1\n', ['n'], { type: 'number' });
    const ni = qa<HTMLInputElement>('input', n.w.el)[0]!;
    ni.focus();
    type(ni, '1.');
    n.refresh();
    expect(ni.value).toBe('1.');
    // an external change does replace the text
    store.setText('name: xyz\n', 'api');
    refresh();
    expect(input.value).toBe('xyz');
  });

  it('is disabled while read-only', () => {
    const { w } = setup('string', 'name: a\n', ['name'], { type: 'string' }, { readOnly: true });
    expect(q<HTMLInputElement>('input', w.el).disabled).toBe(true);
  });

  it('refusals show inline and revert on update', () => {
    const { store, w } = setup('string', 'name: { a: b }\n', ['name', 'a'], { type: 'string' });
    vi.spyOn(store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    const input = q<HTMLInputElement>('input', w.el);
    type(input, 'z');
    expect(q<HTMLElement>('.sw-field-error', w.el).textContent).toBe(defaultUiMessages.editRefused);
    w.update(null, false); // the document did not change: an unfocused box shows the document again
    expect(input.value).toBe('');
    expect(q<HTMLElement>('.sw-field-error', w.el).textContent).toBe('');
  });

  it('a read-only context refuses writes', () => {
    const { store, w } = setup('string', 'name: a\n', ['name'], { type: 'string' }, { readOnly: true });
    const edit = vi.spyOn(store, 'edit');
    const input = q<HTMLInputElement>('input', w.el);
    input.disabled = false; // a host widget could ignore `disabled`
    type(input, 'b');
    expect(edit).not.toHaveBeenCalled();
    expect(store.text).toBe('name: a\n');
  });
});

describe('choice widgets', () => {
  it('enum commits the chosen value; an out-of-list value stays visible', () => {
    const { store, w, refresh } = setup('enum', 'p: Never\n', ['p'], { enum: ['Always', 'Never', 'IfNotPresent'] });
    const select = q<HTMLSelectElement>('select', w.el);
    expect(select.value).toBe('Never');
    select.value = 'Always';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.text).toBe('p: Always\n');
    store.setText('p: Sometimes\n', 'api');
    refresh();
    expect(select.value).toBe('Sometimes');
    expect(qa('option', select).length).toBe(4);
  });

  it('a refused choice reverts the control', () => {
    const { store, w } = setup('enum', 'p: Never\n', ['p'], { enum: ['Always', 'Never'] });
    vi.spyOn(store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    const select = q<HTMLSelectElement>('select', w.el);
    select.value = 'Always';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(select.value).toBe('Never');
    const b = setup('boolean', 'on: true\n', ['on'], { type: 'boolean' });
    vi.spyOn(b.store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    const box = q<HTMLInputElement>('input[type=checkbox]', b.w.el);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(box.checked).toBe(true);
  });

  it('boolean toggles a checkbox', () => {
    const { store, w, data } = setup('boolean', 'on: true\n', ['on'], { type: 'boolean' });
    const box = q<HTMLInputElement>('input[type=checkbox]', w.el);
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(data()['on']).toBe(false);
    expect(store.text).toBe('on: false\n');
  });
});

describe('composite widgets', () => {
  const LABELS = 'labels:\n  a: "1"\n  b: two\n';

  it('key-value add/rename/remove use add/renameKey/delete ops', () => {
    const { store, w, refresh, data } = setup('key-value', LABELS, ['labels'], STRING_MAP, { label: 'Labels' });
    const edit = vi.spyOn(store, 'edit');
    expect(qa('.sw-list-item', w.el).length).toBe(2);

    // add
    const add = q<HTMLElement>('.sw-list-add', w.el);
    type(q('.sw-kv-key', add), 'c');
    type(q('.sw-kv-value', add), 'three');
    q<HTMLButtonElement>('button', add).click();
    refresh();
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'add', at: { doc: 0, path: ['labels'] }, key: 'c', value: 'three' });
    expect(data()['labels']).toEqual({ a: '1', b: 'two', c: 'three' });
    expect(q<HTMLInputElement>('.sw-kv-key', add).value).toBe(''); // cleared

    // value edit goes to the pair
    const first = qa<HTMLElement>('.sw-list-item', w.el)[0]!;
    type(q('.sw-kv-value', first), '11');
    expect((data()['labels'] as Record<string, string>)['a']).toBe('11');
    expect(edit.mock.calls.at(-1)![1]).toEqual({ group: 'visual:0:labels/a' });

    // rename: one renameKey op, in place
    const key = q<HTMLInputElement>('.sw-kv-key', first);
    key.value = 'z';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    refresh();
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'renameKey', at: { doc: 0, path: ['labels', 'a'] }, key: 'z' });
    expect(Object.keys(data()['labels'] as object)).toEqual(['z', 'b', 'c']);
    expect((data()['labels'] as Record<string, string>)['z']).toBe('11');

    // rename to an existing key is refused and reverts
    const row = qa<HTMLElement>('.sw-list-item', w.el).find((r) => q<HTMLInputElement>('.sw-kv-key', r).value === 'b')!;
    const k2 = q<HTMLInputElement>('.sw-kv-key', row);
    k2.value = 'c';
    k2.dispatchEvent(new Event('change', { bubbles: true }));
    refresh();
    expect(Object.keys(data()['labels'] as object).sort()).toEqual(['b', 'c', 'z']);
    expect(k2.value).toBe('b');

    // remove
    const removeB = qa<HTMLButtonElement>('.sw-list-remove', w.el).find((b) => b.getAttribute('aria-label') === 'Remove Labels b')!;
    removeB.click();
    refresh();
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'delete', at: { doc: 0, path: ['labels', 'b'] } });
    expect(Object.keys(data()['labels'] as object).sort()).toEqual(['c', 'z']);
    expect(qa('.sw-list-item', w.el).length).toBe(2);
  });

  it('a rename is one undo step', () => {
    const { store, w } = setup('key-value', LABELS, ['labels'], STRING_MAP);
    const before = store.text;
    const key = q<HTMLInputElement>('.sw-list-item .sw-kv-key', w.el);
    key.value = 'z';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.text).not.toBe(before);
    store.undo();
    expect(store.text).toBe(before);
  });

  it('a rename keeps the pair in its place, with its comment', () => {
    const { store, w } = setup('key-value', 'labels:\n  a: "1" # first\n  b: two\n  c: three\n', ['labels'], STRING_MAP);
    const key = q<HTMLInputElement>('.sw-list-item .sw-kv-key', w.el);
    key.value = 'z';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.text).toBe('labels:\n  z: "1" # first\n  b: two\n  c: three\n');
  });

  it('a refused rename reverts the key, changes nothing and shows why', () => {
    const { store, w } = setup('key-value', LABELS, ['labels'], STRING_MAP);
    const before = store.text;
    vi.spyOn(store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    const key = q<HTMLInputElement>('.sw-list-item .sw-kv-key', w.el);
    key.value = 'z';
    key.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.text).toBe(before);
    expect((toData(store.parsed, 0) as { labels: Record<string, string> }).labels).toEqual({ a: '1', b: 'two' });
    expect(key.value).toBe('a');
    expect(q('.sw-field-error', w.el).textContent).toBe(defaultUiMessages.editRefused);
  });

  it('key-value ignores an add with an empty key', () => {
    const { store, w } = setup('key-value', LABELS, ['labels'], STRING_MAP);
    const edit = vi.spyOn(store, 'edit');
    q<HTMLButtonElement>('.sw-list-add button', w.el).click();
    expect(edit).not.toHaveBeenCalled();
  });

  it('string-list push/remove', () => {
    const { store, w, refresh, data } = setup('string-list', 'args:\n  - a\n  - b\n', ['args'], STRING_ARRAY, { label: 'Args' });
    const edit = vi.spyOn(store, 'edit');
    expect(qa<HTMLInputElement>('.sw-list-item input', w.el).map((i) => i.value)).toEqual(['a', 'b']);

    const add = q<HTMLElement>('.sw-list-add', w.el);
    type(q('input', add), 'c');
    q<HTMLButtonElement>('button', add).click();
    refresh();
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'push', at: { doc: 0, path: ['args'] }, value: 'c' });
    expect(data()['args']).toEqual(['a', 'b', 'c']);

    type(q('.sw-list-item input', w.el), 'aa');
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'set', at: { doc: 0, path: ['args', 0] }, value: 'aa' });
    expect(edit.mock.calls.at(-1)![1]).toEqual({ group: 'visual:0:args/0' });

    qa<HTMLButtonElement>('.sw-list-remove', w.el)[1]!.click();
    refresh();
    expect(edit.mock.calls.at(-1)![0]).toEqual({ op: 'delete', at: { doc: 0, path: ['args', 1] } });
    expect(data()['args']).toEqual(['aa', 'c']);
    expect(qa('.sw-list-item', w.el).length).toBe(2);
  });

  it('composites are disabled while read-only', () => {
    const a = setup('string-list', 'args:\n  - a\n', ['args'], STRING_ARRAY, { readOnly: true });
    const b = setup('key-value', LABELS, ['labels'], STRING_MAP, { readOnly: true });
    for (const c of [...qa<HTMLInputElement | HTMLButtonElement>('input, button', a.w.el), ...qa<HTMLInputElement | HTMLButtonElement>('input, button', b.w.el)]) {
      expect(c.disabled).toBe(true);
    }
  });
});

describe('accessibility', () => {
  const nameOf = (el: Element): string => {
    const id = el.getAttribute('id');
    const forLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
    if (forLabel?.textContent) return forLabel.textContent;
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? '').join(' ').trim();
    return el.getAttribute('aria-label') ?? '';
  };

  it('every widget input is labelled', () => {
    const cases: [string, string, YamlPath, JsonSchema][] = [
      ['string', 'a: x\n', ['a'], { type: 'string' }],
      ['number', 'a: 1\n', ['a'], { type: 'number' }],
      ['integer', 'a: 1\n', ['a'], { type: 'integer' }],
      ['quantity', 'a: 1\n', ['a'], QUANTITY],
      ['int-or-string', 'a: 1\n', ['a'], INT_OR_STRING],
      ['boolean', 'a: true\n', ['a'], { type: 'boolean' }],
      ['enum', 'a: x\n', ['a'], { enum: ['x', 'y'] }],
      ['string-list', 'a:\n  - x\n', ['a'], STRING_ARRAY],
      ['key-value', 'a:\n  k: v\n', ['a'], STRING_MAP],
      ['suggest', 'a: x\n', ['a'], { type: 'string' }],
      ['ref', 'a: x\n', ['a'], { type: 'string' }],
      ['ref-key', 'a: x\n', ['a'], { type: 'string' }],
      ['secret-data', 'a:\n  k: dg==\n', ['a'], STRING_MAP],
    ];
    expect(cases.map((c) => c[0]).sort()).toEqual(Object.keys(defaultWidgets).sort());
    for (const [name, text, path, schema] of cases) {
      host.replaceChildren();
      const { w } = setup(name, text, path, schema, { label: 'Thing' });
      const controls = qa('input, select, textarea, button', w.el);
      expect(controls.length, name).toBeGreaterThan(0);
      for (const c of controls) expect(nameOf(c), `${name}: ${c.outerHTML}`).not.toBe('');
    }
  });
});
