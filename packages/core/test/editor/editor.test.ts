// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../../src/editor/context.js';
import { createEditorWithContext, createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { FormatDefinition, SchemaBundle } from '../../src/formats/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const K8S = 'apiVersion: v1\nkind: Service\n';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, ...options });
  await made.editor.ready;
  return { ...made, adapter, fake: adapter.last! };
}

const key = (target: Element, init: KeyboardEventInit): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
};

describe('values and modes', () => {
  it('getValue returns the initial value', async () => {
    const { editor } = await mount({ value: K8S });
    expect(editor.getValue()).toBe(K8S);
  });

  it("typing in code calls onChange synchronously with origin 'code'", async () => {
    const onChange = vi.fn();
    const { fake } = await mount({ value: K8S, onChange });
    fake.type('a: 1\n');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a: 1\n', { origin: 'code' });
  });

  it('setValue with equal text is a no-op', async () => {
    const onChange = vi.fn();
    const { editor, fake } = await mount({ value: K8S, onChange });
    const apply = vi.spyOn(fake, 'applyChange');
    editor.setValue(K8S);
    expect(onChange).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('setValue applies a minimal splice', async () => {
    const { editor, fake } = await mount({ value: 'name: foo\nabc: 1\n' });
    const apply = vi.spyOn(fake, 'applyChange');
    editor.setValue('name: foo\nxyz: 1\n');
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ from: 10, to: 13, insert: 'xyz' });
    expect(fake.getText()).toBe('name: foo\nxyz: 1\n');
  });

  it('setMode switches panes and calls onModeChange', async () => {
    const onModeChange = vi.fn();
    const { editor } = await mount({ onModeChange });
    const visual = el.querySelector<HTMLElement>('.sw-pane-visual')!;
    const code = el.querySelector<HTMLElement>('.sw-pane-code')!;
    expect(editor.getMode()).toBe('split');
    expect([visual.hidden, code.hidden]).toEqual([false, false]);
    editor.setMode('code');
    expect([visual.hidden, code.hidden]).toEqual([true, false]);
    editor.setMode('visual');
    expect([visual.hidden, code.hidden]).toEqual([false, true]);
    editor.setMode('visual');
    expect(onModeChange.mock.calls).toEqual([['code'], ['visual']]);
  });

  it('mode switch is an APG radio group', async () => {
    const onModeChange = vi.fn();
    const { editor } = await mount({ onModeChange });
    const group = el.querySelector('[role=radiogroup]')!;
    expect(group.getAttribute('aria-label')).toBeTruthy();
    const radios = [...group.querySelectorAll<HTMLElement>('[role=radio]')];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    key(radios[1]!, { key: 'ArrowRight' });
    expect(editor.getMode()).toBe('code');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
    expect(document.activeElement).toBe(radios[2]);
    key(radios[2]!, { key: 'ArrowRight' });
    expect(editor.getMode()).toBe('visual');
    key(radios[0]!, { key: 'ArrowLeft' });
    expect(editor.getMode()).toBe('code');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
  });
});

describe('undo, read-only and theme', () => {
  it('Mod-z from a visual-side input calls store.undo exactly once', async () => {
    const { editor, ctx } = await mount({ value: 'a: 1\n' });
    editor.setValue('a: 2\n');
    const undo = vi.spyOn(ctx.store, 'undo');
    const input = document.createElement('input');
    el.querySelector('.sw-pane-visual')!.append(input);
    const e = new KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(editor.getValue()).toBe('a: 1\n');
    const redo = vi.spyOn(ctx.store, 'redo');
    key(input, { key: 'z', shiftKey: true, metaKey: true, ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe('a: 2\n');
    key(input, { key: 'z', metaKey: true, ctrlKey: true });
    key(input, { key: 'y', metaKey: true, ctrlKey: true });
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('Mod-z in the code pane results in exactly one undo (the adapter owns it)', async () => {
    const { editor, ctx } = await mount({ value: 'a: 1\n' });
    editor.setValue('a: 2\n');
    const undo = vi.spyOn(ctx.store, 'undo');
    key(el.querySelector('textarea')!, { key: 'z', metaKey: true, ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe('a: 1\n');
  });

  it("ready resolves with format 'auto' and empty text", async () => {
    const { editor, ctx } = await mount();
    await expect(editor.ready).resolves.toBeUndefined();
    expect(ctx.format()).toBeUndefined();
  });

  it('undo/redo buttons reflect canUndo/canRedo', async () => {
    const { editor } = await mount({ value: 'a: 1\n' });
    const undo = el.querySelector<HTMLButtonElement>('.sw-undo')!;
    const redo = el.querySelector<HTMLButtonElement>('.sw-redo')!;
    expect([undo.disabled, redo.disabled]).toEqual([true, true]);
    editor.setValue('a: 2\n');
    expect([undo.disabled, redo.disabled]).toEqual([false, true]);
    undo.click();
    expect(editor.getValue()).toBe('a: 1\n');
    expect([undo.disabled, redo.disabled]).toEqual([true, false]);
    redo.click();
    expect(editor.getValue()).toBe('a: 2\n');
  });

  it('readOnly disables typing and edit buttons', async () => {
    const onChange = vi.fn();
    const { editor, fake } = await mount({ value: 'a: 1\n', readOnly: true, onChange });
    fake.type('a: 2\n');
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getValue()).toBe('a: 1\n');
    editor.setValue('a: 3\n'); // the host API still works; undo is then blocked
    const undo = el.querySelector<HTMLButtonElement>('.sw-undo')!;
    expect(undo.disabled).toBe(true);
    expect(editor.undo()).toBe(false);
    editor.setReadOnly(false);
    expect(fake.readOnly).toBe(false);
    expect(undo.disabled).toBe(false);
    expect(editor.undo()).toBe(true);
  });

  it('theme auto sets data-sw-theme from matchMedia', async () => {
    const listeners: (() => void)[] = [];
    const mq = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => {},
    };
    window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
    const { fake } = await mount();
    const root = el.querySelector('.sw-editor')!;
    expect(root.getAttribute('data-sw-theme')).toBe('dark');
    expect(fake.theme).toBe('dark');
    mq.matches = false;
    listeners.forEach((fn) => fn());
    expect(root.getAttribute('data-sw-theme')).toBe('light');
    expect(fake.theme).toBe('light');
  });

  it('explicit theme wins over matchMedia', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    await mount({ theme: 'light' });
    expect(el.querySelector('.sw-editor')!.getAttribute('data-sw-theme')).toBe('light');
  });
});

describe('lifecycle', () => {
  it('default adapter is loaded lazily', async () => {
    const adapter = createFakeAdapter();
    const load = vi.spyOn(loaders, 'loadDefaultAdapter').mockResolvedValue(adapter);
    const editor = createManifestEditor(el, { value: 'a: 1\n' });
    await editor.ready;
    expect(load).toHaveBeenCalledTimes(1);
    expect(adapter.last).toBeDefined();
    editor.destroy();
    load.mockClear();
    await mount();
    expect(load).not.toHaveBeenCalled();
  });

  it('no callbacks after destroy', async () => {
    let resolve!: (b: SchemaBundle | undefined) => void;
    const loadSchema = vi.fn(() => new Promise<SchemaBundle | undefined>((r) => (resolve = r)));
    const custom: FormatDefinition = {
      id: 'custom',
      label: 'Custom',
      version: '1',
      rootModel: 'mapping',
      detect: () => false,
      kinds: () => [],
      loadSchema,
      guide: { groups: [], kinds: {}, fields: {} },
    };
    const onProblemsChange = vi.fn();
    const onChange = vi.fn();
    const { editor, ctx } = await mount({ format: 'custom', formats: [custom], value: 'a: 1\n', onProblemsChange, onChange });
    expect(loadSchema).toHaveBeenCalledTimes(1);
    const pending = ctx.loadBundle(0);
    editor.destroy();
    expect(el.childNodes.length).toBe(0);
    resolve({ id: 'custom', schema: {}, validate: () => [] });
    await expect(pending).resolves.toBeUndefined();
    await Promise.resolve();
    expect(ctx.bundleFor(0)).toBeUndefined();
    expect(onProblemsChange).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(el.childNodes.length).toBe(0);
    editor.destroy(); // idempotent
  });

  it('loadBundle caches by kind for documents formats', async () => {
    const loadSchema = vi.fn(async () => ({ id: 'b', schema: {}, validate: () => [] }) as SchemaBundle);
    const docs: FormatDefinition = {
      id: 'docs',
      label: 'Docs',
      version: '1',
      rootModel: 'documents',
      detect: () => false,
      kinds: () => [],
      loadSchema,
      guide: { groups: [], kinds: {}, fields: {} },
    };
    const { ctx } = await mount({ format: 'docs', formats: [docs], value: `${K8S}---\napiVersion: v1\nkind: Service\n` });
    await ctx.loadBundle(0);
    await ctx.loadBundle(1);
    expect(loadSchema).toHaveBeenCalledTimes(1);
    expect(ctx.bundleFor(1)?.id).toBe('b');
  });
});
