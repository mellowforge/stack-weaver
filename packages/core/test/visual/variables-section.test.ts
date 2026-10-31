// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { parseText } from '../../src/document/parse.js';
import { readBlock } from '../../src/formats/compose/variables/block.js';
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

const BLOCK = 'x-variables:\n  PORT:\n    type: port\n    default: 8080\n  TAG:\n    type: string\n';
const BODY = 'services:\n  web:\n    image: nginx\n    ports:\n      - "${PORT}:80"\n';
const TEXT = BLOCK + BODY;

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'compose', mode: 'visual', value: TEXT, ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0));
  // The first node that is not Variables is selected by default; open the Variables section.
  el.querySelector<HTMLElement>('[role=treeitem] .sw-outline-label')?.click();
  return { ...made, fake: adapter.last! };
}

const labels = () => [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].map((l) => l.textContent);
const cards = () => [...el.querySelectorAll<HTMLElement>('.sw-variable')];
const card = (name: string) => el.querySelector<HTMLElement>(`.sw-variable[data-sw-name="${name}"]`)!;
const ctl = <T extends HTMLElement>(name: string, part: string) => card(name).querySelector<T>(`.sw-variable-${part}`)!;
const type = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) => {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
};
const addButton = () => el.querySelector<HTMLButtonElement>('.sw-variables-add')!;
/** The focused element must be live: connected and not inside a hidden subtree (happy-dom keeps focus on removed ones). */
const focused = () => {
  const a = document.activeElement as HTMLElement;
  expect(a.isConnected).toBe(true);
  expect(a.closest('[hidden]')).toBeNull();
  return a;
};

describe('outline', () => {
  it('compose: the outline starts with Variables; the x-variables key is hidden under the x-variables store', async () => {
    await mount();
    expect(labels()[0]).toBe('Variables');
    expect(labels()).toContain('services');
    expect(labels()).not.toContain('x-variables');
    expect(el.querySelector('.sw-section-title')!.textContent).toBe('Variables');
    expect(el.querySelector('.sw-section-remove')!.closest('[hidden]')).not.toBeNull();
  });

  it('compose + external store: Variables is shown and an x-variables key in the text stays a normal node', async () => {
    await mount({ variables: { store: 'external', value: [{ name: 'A', type: 'string' }] } });
    expect(labels()[0]).toBe('Variables');
    expect(labels()).toContain('x-variables');
    expect(cards().map((c) => c.dataset['swName'])).toEqual(['A']);
  });

  it('kubernetes: no Variables node', async () => {
    await mount({ format: 'kubernetes', value: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n' });
    expect(labels()).not.toContain('Variables');
    expect(el.querySelector('.sw-variables')).toBeNull();
  });

  it('revealing a root-path problem keeps the current card; a path under x-variables opens Variables', async () => {
    const { editor } = await mount();
    const title = () => el.querySelector('.sw-section-title')!.textContent;
    const open = (label: string) =>
      [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].find((l) => l.textContent === label)!.click();
    open('services');
    expect(title()).toBe('services');
    editor.reveal({ doc: 0, path: [] }); // yaml.warning, rule.failed, a root yaml.data error
    expect(title()).toBe('services');
    editor.reveal({ doc: 0, path: ['x-variables', 'PORT', 'type'] });
    expect(title()).toBe('Variables');
    editor.reveal({ doc: 0, path: ['services', 'web'] });
    expect(title()).not.toBe('Variables');
    // picking Variables in the outline still holds across a re-render
    open('Variables');
    editor.setReadOnly(true);
    expect(title()).toBe('Variables');
  });
});

describe('cards', () => {
  it('lists declarations; editing default writes a typed default to the block (one undo step)', async () => {
    const { editor } = await mount();
    expect(cards().map((c) => c.dataset['swName'])).toEqual(['PORT', 'TAG']);
    expect(card('PORT').querySelector('legend')!.textContent).toBe('PORT');
    expect(ctl<HTMLInputElement>('PORT', 'default').value).toBe('8080');
    type(ctl<HTMLInputElement>('PORT', 'default'), '9090');
    expect(editor.getValue()).toContain('default: 9090');
    expect(editor.getVariables()[0]).toEqual({ name: 'PORT', type: 'port', default: 9090 });
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(TEXT);
    expect(ctl<HTMLInputElement>('PORT', 'default').value).toBe('8080');
  });

  it('number and port defaults must parse; a bad one shows a message and changes nothing', async () => {
    const { editor } = await mount();
    const input = ctl<HTMLInputElement>('PORT', 'default');
    for (const bad of ['abc', '0', '70000', '1.5']) {
      type(input, bad);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(card('PORT').querySelector('.sw-field-error')!.textContent).not.toBe('');
      expect(editor.getValue()).toBe(TEXT);
    }
    type(input, '81');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(editor.getVariables()[0]!.default).toBe(81);
    type(input, '');
    expect(editor.getVariables()[0]).toEqual({ name: 'PORT', type: 'port' });
  });

  it('boolean default is a select (empty/true/false); description commits', async () => {
    const { editor } = await mount();
    type(ctl('TAG', 'type'), 'boolean');
    const sel = ctl<HTMLSelectElement>('TAG', 'default');
    expect(sel.tagName).toBe('SELECT');
    expect([...sel.options].map((o) => o.value)).toEqual(['', 'true', 'false']);
    type(sel, 'true');
    type(ctl('TAG', 'description'), 'Flag');
    expect(editor.getVariables()[1]).toEqual({ name: 'TAG', type: 'boolean', default: true, description: 'Flag' });
  });

  it('renaming commits on change and keeps focus in that card; an invalid or taken name shows the message and changes nothing', async () => {
    const { editor } = await mount();
    const input = ctl<HTMLInputElement>('TAG', 'name');
    input.focus();
    type(input, 'bad name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(card('TAG').querySelector('.sw-field-error')!.textContent).toBe('Use letters, digits and _, starting with a letter or _.');
    expect(editor.getValue()).toBe(TEXT);
    type(input, 'PORT');
    expect(card('TAG').querySelector('.sw-field-error')!.textContent).toBe('A variable named PORT already exists.');
    expect(editor.getValue()).toBe(TEXT);
    type(input, 'IMAGE_TAG');
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT', 'IMAGE_TAG']);
    expect(cards().map((c) => c.dataset['swName'])).toEqual(['PORT', 'IMAGE_TAG']);
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(focused()).toBe(ctl('IMAGE_TAG', 'name'));
  });

  it('changing type to enum shows allowed values; an incompatible default is dropped', async () => {
    const { editor } = await mount();
    expect(card('PORT').querySelector('.sw-variable-enum')).toBeNull();
    ctl<HTMLSelectElement>('PORT', 'type').focus();
    type(ctl('PORT', 'type'), 'enum');
    expect(ctl('PORT', 'enum')).toBeTruthy();
    expect(ctl('PORT', 'enum').isConnected).toBe(true);
    expect(ctl('PORT', 'enum').closest('[hidden]')).toBeNull();
    expect(focused()).toBe(ctl('PORT', 'type')); // WCAG 3.2.2: changing the select does not move focus
    expect(ctl<HTMLSelectElement>('PORT', 'type').value).toBe('enum');
    type(ctl('PORT', 'enum'), 'http, https , ');
    expect(editor.getVariables()[0]).toEqual({ name: 'PORT', type: 'enum', enumValues: ['http', 'https'] });
    const def = ctl<HTMLSelectElement>('PORT', 'default');
    expect([...def.options].map((o) => o.value)).toEqual(['', 'http', 'https']);
    type(def, 'https');
    expect(editor.getVariables()[0]!.default).toBe('https');
    type(ctl('PORT', 'enum'), 'http');
    expect(editor.getVariables()[0]!.default).toBeUndefined();
    type(ctl('PORT', 'type'), 'string');
    expect(editor.getVariables()[0]).toEqual({ name: 'PORT', type: 'string' });
    expect(card('PORT').querySelector('.sw-variable-enum')).toBeNull();
  });

  it('emptying the allowed values keeps the declaration and shows a message', async () => {
    const { editor } = await mount();
    type(ctl('PORT', 'type'), 'enum');
    type(ctl('PORT', 'enum'), 'a, b');
    const before = editor.getValue();
    type(ctl('PORT', 'enum'), ' , ');
    expect(ctl('PORT', 'enum').getAttribute('aria-invalid')).toBe('true');
    expect(card('PORT').querySelector('.sw-field-error')!.textContent).toBe('List at least one value.');
    expect(editor.getValue()).toBe(before);
  });

  it('a default that still fits the new type is kept', async () => {
    const { editor } = await mount();
    type(ctl('PORT', 'type'), 'number');
    expect(editor.getVariables()[0]).toEqual({ name: 'PORT', type: 'number', default: 8080 });
  });

  it('a refused edit shows the message, resets the controls to the declaration and keeps focus', async () => {
    // A multi-line flow entry: changing the type to boolean drops the default, which is refused there.
    const text = 'x-variables:\n  PORT: { type: port,\n    default: 8080 }\n' + BODY;
    const { editor } = await mount({ value: text });
    const select = ctl<HTMLSelectElement>('PORT', 'type');
    select.focus();
    type(select, 'boolean');
    expect(editor.getValue()).toBe(text);
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port', default: 8080 }]);
    expect(card('PORT').querySelector('.sw-field-error')!.textContent).toBe('This value cannot be changed here. Edit it in code.');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(ctl('PORT', 'type')).toBe(select);
    expect(select.value).toBe('port');
    expect(ctl<HTMLInputElement>('PORT', 'default').value).toBe('8080');
    expect(focused()).toBe(select);
  });

  it('a multi-op type change keeps the same select connected and focused (no intermediate render)', async () => {
    // port → boolean drops the default: two ops, and the declaration is invalid between them.
    const { editor } = await mount();
    const select = ctl<HTMLSelectElement>('PORT', 'type');
    select.focus();
    type(select, 'boolean');
    expect(editor.getValue()).toBe(TEXT.replace('    type: port\n    default: 8080\n', '    type: boolean\n'));
    expect(select.isConnected).toBe(true);
    expect(ctl('PORT', 'type')).toBe(select);
    expect(focused()).toBe(select);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(TEXT);
  });

  it('a refused rename shows the message, puts the old name back and keeps focus', async () => {
    const text = 'x-variables: { PORT: { type: port, default: 8080 } }\n' + BODY; // renameKey in a flow map is refused
    const { editor } = await mount({ value: text });
    const name = ctl<HTMLInputElement>('PORT', 'name');
    name.focus();
    type(name, 'HTTP_PORT');
    expect(editor.getValue()).toBe(text);
    expect(ctl('PORT', 'name')).toBe(name);
    expect(name.value).toBe('PORT');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(card('PORT').querySelector('.sw-field-error')!.textContent).toBe('This value cannot be changed here. Edit it in code.');
    expect(focused()).toBe(name);
  });

  it('a refused enum commit keeps the typed values with the message and keeps focus', async () => {
    const text = 'x-variables:\n  E: { type: enum,\n    enum: [a, b] }\n' + BODY;
    const { editor } = await mount({ value: text });
    const input = ctl<HTMLInputElement>('E', 'enum');
    input.focus();
    type(input, 'a, c');
    expect(editor.getValue()).toBe(text);
    expect(editor.getVariables()).toEqual([{ name: 'E', type: 'enum', enumValues: ['a', 'b'] }]);
    expect(ctl('E', 'enum')).toBe(input);
    expect(input.value).toBe('a, c');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(card('E').querySelector('.sw-field-error')!.textContent).toBe('This value cannot be changed here. Edit it in code.');
    expect(focused()).toBe(input);
  });

  it('a refused first enum commit (type just switched to enum) keeps the enum field and the typed values', async () => {
    const text = 'x-variables:\n  PORT: { type: port,\n    default: 8080 }\n' + BODY;
    const { editor } = await mount({ value: text });
    type(ctl('PORT', 'type'), 'enum');
    const input = ctl<HTMLInputElement>('PORT', 'enum');
    input.focus();
    type(input, 'http, https');
    expect(editor.getValue()).toBe(text);
    expect(ctl('PORT', 'enum')).toBe(input);
    expect(input.closest('[hidden]')).toBeNull();
    expect(input.value).toBe('http, https');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(ctl<HTMLSelectElement>('PORT', 'type').value).toBe('enum');
    expect(focused()).toBe(input);
  });

  it('keeps focus in the edited control across re-renders', async () => {
    await mount();
    const d = ctl<HTMLInputElement>('TAG', 'description');
    d.focus();
    type(d, 'x');
    expect(focused()).toBe(d);
    expect(ctl('TAG', 'description')).toBe(d);
  });

  it('Add variable adds VAR_1, then VAR_2, and focuses the name input', async () => {
    const { editor } = await mount({ value: BODY });
    expect(el.querySelector('.sw-variables-empty')!.closest('[hidden]')).toBeNull();
    addButton().click();
    expect(editor.getVariables()).toEqual([{ name: 'VAR_1', type: 'string' }]);
    expect(focused()).toBe(ctl('VAR_1', 'name'));
    expect(el.querySelector('.sw-variables-empty')!.closest('[hidden]')).not.toBeNull();
    addButton().click();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['VAR_1', 'VAR_2']);
    expect(focused()).toBe(ctl('VAR_2', 'name'));
    type(ctl('VAR_1', 'name'), 'X');
    addButton().click();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['X', 'VAR_2', 'VAR_1']);
  });

  it('remove deletes the declaration and moves focus to the next card; with the last one the block goes', async () => {
    const { editor } = await mount();
    ctl<HTMLButtonElement>('PORT', 'remove').click();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['TAG']);
    expect(focused()).toBe(ctl('TAG', 'name'));
    ctl<HTMLButtonElement>('TAG', 'remove').click();
    expect(editor.getVariables()).toEqual([]);
    expect(editor.getValue()).toBe(BODY);
    expect(focused()).toBe(addButton());
    expect(editor.undo()).toBe(true);
    expect(cards().length).toBe(1);
  });

  it('remove button is named after the variable', async () => {
    await mount();
    expect(ctl('PORT', 'remove').textContent).toBe('Remove variable PORT');
  });

  it.each([
    ['an empty', ''],
    ['a comment-only', '# hi\n'],
  ])('Add variable on %s document starts the block (one undo step), keeping the text before it', async (_k, value) => {
    const { editor } = await mount({ value });
    addButton().click();
    const text = editor.getValue();
    expect(text.startsWith(value)).toBe(true);
    expect(text).toContain('x-variables:\n  VAR_1:\n    type: string\n');
    expect(readBlock(parseText(text)).decls).toEqual([{ name: 'VAR_1', type: 'string' }]);
    expect(focused()).toBe(ctl('VAR_1', 'name'));
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(value);
  });

  it('a refused Add variable (the block is not a mapping) says so in an alert and keeps the focus on the button', async () => {
    const value = `x-variables: 5\n${BODY}`;
    const { editor } = await mount({ value });
    const error = el.querySelector<HTMLElement>('.sw-variables-error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe('');
    addButton().focus();
    addButton().click();
    expect(editor.getValue()).toBe(value);
    expect(error.textContent).toBe(defaultUiMessages.editRefused);
    expect(focused()).toBe(addButton());
  });
});

describe('external store and states', () => {
  it('external store: edits fire onVariablesChange and never touch the text', async () => {
    const onVariablesChange = vi.fn();
    const { editor } = await mount({ value: BODY, variables: { store: 'external', value: [] }, onVariablesChange });
    addButton().click();
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    type(ctl('VAR_1', 'default'), 'x');
    expect(onVariablesChange).toHaveBeenCalledTimes(2);
    expect(editor.getVariables()).toEqual([{ name: 'VAR_1', type: 'string', default: 'x' }]);
    expect(editor.getValue()).toBe(BODY);
  });

  it('re-renders when the host sets variables', async () => {
    const { editor } = await mount({ variables: { store: 'external', value: [] } });
    editor.setVariables([{ name: 'A', type: 'string' }]);
    expect(cards().map((c) => c.dataset['swName'])).toEqual(['A']);
  });

  it('every control has an accessible name; read-only disables them', async () => {
    const { editor } = await mount();
    const controls = () => [...el.querySelectorAll<HTMLElement>('.sw-variables input, .sw-variables select, .sw-variables button')];
    for (const c of controls()) {
      const name = c.getAttribute('aria-label') || c.closest('label')?.textContent?.trim() || (c.tagName === 'BUTTON' ? c.textContent!.trim() : '');
      expect(name, c.className).not.toBe('');
    }
    expect(controls().every((c) => !(c as HTMLInputElement).disabled)).toBe(true);
    editor.setReadOnly(true);
    expect(controls().length).toBeGreaterThan(0);
    expect(controls().every((c) => (c as HTMLInputElement).disabled)).toBe(true);
    editor.setReadOnly(false);
    expect(controls().every((c) => !(c as HTMLInputElement).disabled)).toBe(true);
  });

  it('broken text disables the controls', async () => {
    const { fake } = await mount();
    fake.type(TEXT + 'a: [\n');
    await vi.waitFor(() => expect(addButton().disabled).toBe(true));
    expect(cards().length).toBe(2);
    expect(ctl<HTMLInputElement>('PORT', 'name').disabled).toBe(true);
  });
});
