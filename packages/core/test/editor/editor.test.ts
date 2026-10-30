// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../../src/editor/context.js';
import { createEditorWithContext, createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { CodeEditorAdapter } from '../../src/editors/adapter.js';
import type { FormatDefinition, SchemaBundle } from '../../src/formats/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const K8S = 'apiVersion: v1\nkind: Service\n';

let el: HTMLElement;
const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  el.remove();
  vi.restoreAllMocks();
});

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, ...options });
  await made.editor.ready;
  return { ...made, adapter, fake: adapter.last! };
}

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
/** The platform's single "Mod" modifier: Meta on Apple platforms, Ctrl elsewhere. */
const mod = isMac ? { metaKey: true } : { ctrlKey: true };
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
    const e = new KeyboardEvent('keydown', { key: 'z', ...mod, bubbles: true, cancelable: true });
    input.dispatchEvent(e);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(editor.getValue()).toBe('a: 1\n');
    const redo = vi.spyOn(ctx.store, 'redo');
    key(input, { key: 'z', shiftKey: true, ...mod });
    expect(redo).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe('a: 2\n');
    key(input, { key: 'z', ...mod });
    key(input, { key: 'y', ...mod });
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it('Mod-z in the code pane results in exactly one undo (the adapter owns it)', async () => {
    const { editor, ctx } = await mount({ value: 'a: 1\n' });
    editor.setValue('a: 2\n');
    const undo = vi.spyOn(ctx.store, 'undo');
    key(el.querySelector('textarea')!, { key: 'z', ...mod });
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

  it('setTheme changes the theme after mount, and auto starts and stops following matchMedia', async () => {
    const listeners = new Set<() => void>();
    const mq = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
    const { editor, fake } = await mount({ theme: 'light' });
    const root = el.querySelector('.sw-editor')!;
    expect(listeners.size).toBe(0);

    editor.setTheme('dark');
    expect([root.getAttribute('data-sw-theme'), fake.theme]).toEqual(['dark', 'dark']);

    editor.setTheme('auto'); // matches: dark
    expect(listeners.size).toBe(1);
    mq.matches = false;
    listeners.forEach((fn) => fn());
    expect([root.getAttribute('data-sw-theme'), fake.theme]).toEqual(['light', 'light']);

    editor.setTheme('dark');
    expect(listeners.size).toBe(0);
    expect(root.getAttribute('data-sw-theme')).toBe('dark');
    editor.setTheme('auto');
    editor.destroy();
    expect(listeners.size).toBe(0);
  });

  it('getReadOnly reports the read-only state', async () => {
    const { editor } = await mount({ readOnly: true });
    expect(editor.getReadOnly()).toBe(true);
    editor.setReadOnly(false);
    expect(editor.getReadOnly()).toBe(false);
  });

  it('onModeChange fires for setMode too, and not for the current mode', async () => {
    const onModeChange = vi.fn();
    const { editor } = await mount({ onModeChange });
    editor.setMode('split');
    expect(onModeChange).not.toHaveBeenCalled();
    editor.setMode('code');
    expect(onModeChange).toHaveBeenCalledWith('code');
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

  it('destroy while the default adapter is still loading: nothing is mounted', async () => {
    let resolve!: (a: CodeEditorAdapter) => void;
    const adapter = createFakeAdapter();
    const mountAdapter = vi.spyOn(adapter, 'mount');
    vi.spyOn(loaders, 'loadDefaultAdapter').mockReturnValue(new Promise<CodeEditorAdapter>((r) => (resolve = r)));
    const editor = createManifestEditor(el, { value: 'a: 1\n' });
    editor.destroy();
    resolve(adapter);
    await editor.ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(mountAdapter).not.toHaveBeenCalled();
    expect(el.childNodes.length).toBe(0);
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
    // `ready` waits for the first validation, which waits for the schema: do not await it here.
    const { editor, ctx } = createEditorWithContext(el, {
      codeEditor: createFakeAdapter(),
      format: 'custom',
      formats: [custom],
      value: 'a: 1\n',
      onProblemsChange,
      onChange,
    });
    await vi.waitFor(() => expect(loadSchema).toHaveBeenCalledTimes(1)); // the first validation is pending
    const pending = ctx.loadBundle(0);
    const root = el.querySelector<HTMLElement>('.sw-editor')!; // detached by destroy, but still referenced here
    editor.destroy();
    expect(el.childNodes.length).toBe(0);
    const snapshot = root.outerHTML;
    // Were the result not dropped, this schema would publish one error.
    resolve({ id: 'custom', schema: {}, validate: () => [{ instancePath: '/a', keyword: 'type', params: { type: 'string' } }] });
    await expect(pending).resolves.toBeUndefined();
    await expect(editor.ready).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(root.outerHTML).toBe(snapshot); // nothing was written into the released DOM
    expect(editor.getProblems()).toEqual([]);
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

  const failing = (loadSchema: FormatDefinition['loadSchema']): FormatDefinition => ({
    id: 'bad',
    label: 'Bad',
    version: '1',
    rootModel: 'mapping',
    detect: () => false,
    kinds: () => [],
    loadSchema,
    guide: { groups: [], kinds: {}, fields: {} },
  });

  it('a rejecting loadSchema is recorded, logged once, and never unhandled', async () => {
    const boom = new Error('boom');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { ctx } = await mount({ format: 'bad', formats: [failing(() => Promise.reject(boom))], value: 'a: 1\n' });
    await ctx.loadBundle(0);
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(ctx.bundleError(0)).toBe(boom);
    expect(ctx.bundleFor(0)).toBeUndefined();
    await expect(ctx.loadBundle(0)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('a synchronously throwing loadSchema is recorded the same way', async () => {
    const boom = new Error('sync boom');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = await mount({
      format: 'bad',
      formats: [failing(() => { throw boom; })],
      value: 'a: 1\n',
    });
    await expect(ctx.loadBundle(0)).resolves.toBeUndefined();
    expect(ctx.bundleError(0)).toBe(boom);
  });

  it('an unknown kind is not an error', async () => {
    const { ctx } = await mount({ format: 'bad', formats: [failing(async () => undefined)], value: 'a: 1\n' });
    await expect(ctx.loadBundle(0)).resolves.toBeUndefined();
    expect(ctx.bundleError(0)).toBeUndefined();
  });
});

describe('code pane stays in step with the store', () => {
  it('format resolution on setValue into an empty auto editor does not duplicate text', async () => {
    const { editor, fake } = await mount();
    const apply = vi.spyOn(fake, 'applyChange');
    editor.setValue('services:\n  web:\n    image: nginx\n');
    expect(fake.getText()).toBe(editor.getValue());
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('explicit-format setValue keeps the adapter in step', async () => {
    const { editor, fake } = await mount({ format: 'kubernetes' });
    editor.setValue(K8S);
    expect(fake.getText()).toBe(K8S);
  });

  it('applies exactly one splice per non-code change and none for typing (safety net never fires)', async () => {
    const { editor, fake } = await mount();
    const apply = vi.spyOn(fake, 'applyChange');
    fake.type('a: 1\n');
    expect(apply).toHaveBeenCalledTimes(0);
    editor.setValue('services:\n  web:\n    image: nginx\n'); // also resolves the format
    expect(apply).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toBe(true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(editor.redo()).toBe(true);
    expect(apply).toHaveBeenCalledTimes(3);
    for (const [change] of apply.mock.calls) expect(change.insert.length).toBeLessThan(editor.getValue().length);
    expect(fake.getText()).toBe(editor.getValue());
  });

  it('the safety net logs when it has to replace the whole text', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { editor, fake } = await mount({ value: 'a: 1\n' });
    fake.applyChange({ from: 0, to: 0, insert: '# drift\n' }); // the editor no longer matches the store
    editor.setValue('a: 2\n');
    expect(fake.getText()).toBe('a: 2\n');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toBe('stack-weaver: code editor out of sync with the store');
  });

  it('readOnly plus setValue keeps the adapter text equal to the store', async () => {
    const onChange = vi.fn();
    const { editor, fake } = await mount({ value: 'a: 1\n', readOnly: true, onChange });
    editor.setValue('a: 2\nb: 3\n');
    expect(fake.getText()).toBe('a: 2\nb: 3\n');
    expect(fake.getText()).toBe(editor.getValue());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a: 2\nb: 3\n', { origin: 'api' });
  });
});
