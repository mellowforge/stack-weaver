// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

const BLOCK = 'x-variables:\n  WEB_PORT:\n    type: port\n    default: 8080\n  SCALE:\n    type: number\n    default: 3\n  TAG:\n    type: string\n  DEBUG:\n    type: boolean\n';
const TAG_ONLY = 'x-variables:\n  TAG:\n    type: string\n';
const svc = (extra: string, block = BLOCK) => `${block}services:\n  web:\n    image: nginx\n${extra}`;

async function mount(text: string, options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'compose', mode: 'visual', value: text, ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0));
  const web = [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].find((l) => l.textContent === 'web');
  web?.click();
  return { ...made, fake: adapter.last! };
}

const row = (key: string) => el.querySelector<HTMLElement>(`.sw-section .sw-row[data-sw-key="${key}"]`)!;
const toggle = (key: string) => row(key).querySelector<HTMLButtonElement>('button.sw-row-variable-toggle')!;
const select = (key: string) => row(key).querySelector<HTMLSelectElement>('.sw-variable-binding select')!;
const optionTexts = (key: string) => [...select(key).options].map((o) => o.textContent);
const choose = (s: HTMLSelectElement, v: string) => {
  s.value = v;
  s.dispatchEvent(new Event('change', { bubbles: true }));
};
/** The focused element must be live: connected and not inside a hidden subtree (happy-dom keeps focus on removed ones). */
const focused = () => {
  const a = document.activeElement as HTMLElement;
  expect(a.isConnected).toBe(true);
  expect(a.closest('[hidden]')).toBeNull();
  return a;
};

describe('use-variable toggle', () => {
  it('compose scalar rows have a labelled toggle; kubernetes rows have none', async () => {
    await mount(svc('    scale: 2\n'));
    const t = toggle('scale');
    expect(t).not.toBeNull();
    expect(t.getAttribute('aria-label')).toBe('Use variable');
    expect(t.getAttribute('aria-pressed')).toBe('false');
    el.replaceChildren();
    const adapter = createFakeAdapter();
    const k = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'visual', value: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: a\n' });
    await k.editor.ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector('.sw-row')).not.toBeNull();
    expect(el.querySelector('.sw-row-variable-toggle')).toBeNull();
  });

  it('a ${SCALE} value opens in variable mode with SCALE selected', async () => {
    await mount(svc('    scale: ${SCALE}\n'));
    expect(toggle('scale').getAttribute('aria-pressed')).toBe('true');
    expect(select('scale').value).toBe('SCALE');
  });

  it('the select lists only fitting variables, sorted: scale lists number and port, not string or boolean', async () => {
    await mount(svc('    scale: 2\n'));
    toggle('scale').click();
    expect(optionTexts('scale').filter((t) => t)).toEqual(['SCALE', 'WEB_PORT']);
    expect(select('scale').value).toBe('');
    expect(select('scale').getAttribute('aria-label')).toBe('Variable for scale');
  });

  it('pressing commits nothing; focus stays on the toggle', async () => {
    const { editor } = await mount(svc('    scale: 2\n'));
    const before = editor.getValue();
    toggle('scale').focus();
    toggle('scale').click();
    expect(editor.getValue()).toBe(before);
    expect(toggle('scale').getAttribute('aria-pressed')).toBe('true');
    expect(focused()).toBe(toggle('scale'));
  });

  it('choosing commits bare ${NAME} as one undo step; the select keeps focus; toggling off commits the typed default', async () => {
    const { editor } = await mount(svc('    scale: 2\n'));
    toggle('scale').click();
    const s = select('scale');
    s.focus();
    choose(s, 'WEB_PORT');
    expect(editor.getValue()).toContain('    scale: ${WEB_PORT}\n');
    expect(editor.getValue()).not.toContain(':-');
    expect(focused()).toBe(select('scale'));
    toggle('scale').focus();
    toggle('scale').click();
    expect(editor.getValue()).toContain('    scale: 8080\n');
    expect(toggle('scale').getAttribute('aria-pressed')).toBe('false');
    expect(focused()).toBe(toggle('scale'));
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toContain('    scale: ${WEB_PORT}\n');
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toContain('    scale: 2\n');
  });

  it('toggling off a variable without a default commits nothing and shows the type widget', async () => {
    const { editor } = await mount(svc('    restart: ${TAG}\n'));
    const before = editor.getValue();
    expect(toggle('restart').getAttribute('aria-pressed')).toBe('true');
    toggle('restart').click();
    expect(editor.getValue()).toBe(before);
    expect(toggle('restart').getAttribute('aria-pressed')).toBe('false');
    expect(row('restart').querySelector('.sw-variable-binding')).toBeNull();
    expect(row('restart').querySelector('input')).not.toBeNull();
  });

  it('an undeclared reference shows "(not declared)" and stays selected', async () => {
    await mount(svc('    scale: ${GONE}\n'));
    expect(select('scale').value).toBe('GONE');
    expect(optionTexts('scale')).toContain('GONE (not declared)');
  });

  it('a misfit reference stays listed as not declared', async () => {
    await mount(svc('    scale: ${DEBUG}\n'));
    expect(select('scale').value).toBe('DEBUG');
    expect(optionTexts('scale')).toContain('DEBUG (not declared)');
  });

  it('with no fitting variable the select is replaced by the none text', async () => {
    await mount(svc('    scale: 2\n', TAG_ONLY));
    toggle('scale').click();
    expect(row('scale').querySelector('select')).toBeNull();
    expect(row('scale').querySelector('.sw-variable-binding')!.textContent).toContain('No variables of this type yet.');
  });

  it('the select follows variables added later', async () => {
    const { editor } = await mount(svc('    scale: 2\n', TAG_ONLY));
    toggle('scale').click();
    editor.setValue(svc('    scale: 2\n'));
    await new Promise((r) => setTimeout(r, 0));
    expect(row('scale').querySelector('select')).not.toBeNull();
  });

  it('a boolean field holding the string "yes" shows read-only text, not the boolean widget', async () => {
    await mount(svc('    privileged: "yes"\n'));
    expect(row('privileged').querySelector('.sw-row-value')!.textContent).toBe('yes');
    expect(row('privileged').querySelector('input, select, [role=switch]')).toBeNull();
  });

  it('an enum field holding a non-option string shows read-only text; an option keeps the select', async () => {
    await mount(svc('    cgroup: nope\n'));
    expect(row('cgroup').querySelector('.sw-row-value')!.textContent).toBe('nope');
    expect(row('cgroup').querySelector('select')).toBeNull();
    el.replaceChildren();
    await mount(svc('    cgroup: host\n'));
    expect(row('cgroup').querySelector('.sw-row-value')).toBeNull();
    expect(row('cgroup').querySelector('select')).not.toBeNull();
  });

  it('unpressing a no-default placeholder on a boolean field shows the boolean widget, empty; picking commits', async () => {
    const { editor } = await mount(svc('    privileged: ${DEBUG}\n'));
    const before = editor.getValue();
    toggle('privileged').focus();
    toggle('privileged').click();
    expect(editor.getValue()).toBe(before);
    expect(row('privileged').querySelector('.sw-row-value')).toBeNull();
    const box = row('privileged').querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(box.checked).toBe(false);
    expect(focused()).toBe(toggle('privileged'));
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(editor.getValue()).toContain('    privileged: true\n');
    expect(toggle('privileged').getAttribute('aria-pressed')).toBe('false');
  });

  it('unpressing a misfit reference does not commit that variable default', async () => {
    const block = 'x-variables:\n  GREETING:\n    type: string\n    default: hi\n';
    const { editor } = await mount(svc('    scale: ${GREETING}\n', block));
    const before = editor.getValue();
    expect(toggle('scale').getAttribute('aria-pressed')).toBe('true');
    toggle('scale').click();
    expect(editor.getValue()).toBe(before);
    expect(toggle('scale').getAttribute('aria-pressed')).toBe('false');
    expect(row('scale').querySelector('.sw-variable-binding')).toBeNull();
  });

  it('a refused choice resets the select and shows the refusal', async () => {
    const { fake } = await mount(svc('    scale: 2\n'));
    toggle('scale').click();
    fake.type('x: [');
    const s = select('scale');
    choose(s, 'SCALE');
    expect(select('scale').value).toBe('');
    expect(row('scale').querySelector('.sw-variable-binding .sw-field-error')!.textContent).not.toBe('');
    expect(fake.getText()).toBe('x: [');
  });

  it('a boolean field holding true still shows the boolean widget', async () => {
    await mount(svc('    privileged: true\n'));
    expect(row('privileged').querySelector('.sw-row-value')).toBeNull();
    expect(row('privileged').querySelector('input, select, [role=switch]')).not.toBeNull();
  });

  it('the toggle is disabled while the editor is read-only', async () => {
    await mount(svc('    scale: 2\n'), { readOnly: true });
    expect(toggle('scale').disabled).toBe(true);
  });
});

describe('variable completion in the code pane', () => {
  it('typing "${W" in a compose value offers the variables', async () => {
    const { fake } = await mount(svc('    restart: ${W'));
    const text = fake.getText();
    const r = await fake.init.complete!(text, text.length, false);
    expect(r!.from).toBe(text.length - 1);
    const o = r!.options.find((x) => x.label === 'WEB_PORT')!;
    expect(o.apply).toBe('WEB_PORT}');
    expect(o.detail).toBe('port');
    expect(o.section).toEqual({ name: 'Variables', rank: 0 });
  });

  it('an existing } after the caret is not doubled; a bare "${" offers all', async () => {
    const { fake } = await mount(svc('    restart: ${}\n'));
    const text = fake.getText();
    const caret = text.indexOf('${}') + 2;
    const r = await fake.init.complete!(text, caret, false);
    expect(r!.from).toBe(caret);
    expect(r!.options.find((o) => o.label === 'TAG')!.apply).toBe('TAG');
    expect(r!.options).toHaveLength(4);
  });

  it('kubernetes offers nothing', async () => {
    const adapter = createFakeAdapter();
    const t = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: ${W';
    const k = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'code', value: t });
    await k.editor.ready;
    const r = await adapter.last!.init.complete!(t, t.length, false);
    expect(r).toBeNull();
  });

  it('a comment line does not complete', async () => {
    const { fake } = await mount(svc('    # ${W'));
    const r = await fake.init.complete!(fake.getText(), fake.getText().length, false);
    expect(r).toBeNull();
  });
});
