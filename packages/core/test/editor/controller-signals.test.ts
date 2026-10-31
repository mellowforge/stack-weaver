// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const K8S = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n';
const COMPOSE = 'services:\n  web:\n    image: nginx\n';
const COMPOSE2 = 'services:\n  api:\n    image: node\n';

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
  const editor = createManifestEditor(el, { codeEditor: adapter, ...options });
  await editor.ready;
  return { editor, fake: adapter.last! };
}

describe('history signals', () => {
  it('onHistoryChange fires on the first undoable change and when undo empties the stack', async () => {
    const calls: unknown[] = [];
    const { editor } = await mount({ value: K8S, onHistoryChange: (s) => calls.push({ ...s }) });
    expect(calls).toEqual([]);
    editor.setValue(K8S + '# c\n');
    expect(calls).toEqual([{ canUndo: true, canRedo: false }]);
    editor.undo();
    expect(calls).toEqual([
      { canUndo: true, canRedo: false },
      { canUndo: false, canRedo: true },
    ]);
  });

  it('onHistoryChange is not repeated for a second change with the same flags', async () => {
    const onHistoryChange = vi.fn();
    const { editor } = await mount({ value: K8S, onHistoryChange });
    editor.setValue(K8S + '# a\n');
    editor.setValue(K8S + '# b\n');
    expect(onHistoryChange).toHaveBeenCalledTimes(1);
  });

  it('clearHistory() drops undo and redo and reports {false,false}; the text is unchanged', async () => {
    const calls: unknown[] = [];
    const { editor } = await mount({ value: K8S, onHistoryChange: (s) => calls.push({ ...s }) });
    editor.setValue(K8S + '# a\n');
    editor.setValue(K8S + '# b\n');
    editor.undo();
    calls.length = 0;
    editor.clearHistory();
    expect(calls).toEqual([{ canUndo: false, canRedo: false }]);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.getValue()).toBe(K8S + '# a\n');
  });

  it("reset(text) replaces the text, fires onChange once with origin 'api', and leaves nothing to undo", async () => {
    const onChange = vi.fn();
    const { editor } = await mount({ value: K8S, onChange });
    editor.setValue(K8S + '# a\n');
    onChange.mockClear();
    editor.reset(COMPOSE);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(COMPOSE, { origin: 'api' });
    expect(editor.getValue()).toBe(COMPOSE);
    expect(editor.canUndo()).toBe(false);
    expect(editor.undo()).toBe(false);
  });

  it('reset(sameText) only clears the history: no onChange', async () => {
    const onChange = vi.fn();
    const onHistoryChange = vi.fn();
    const { editor } = await mount({ value: K8S, onChange, onHistoryChange });
    editor.setValue(K8S + '# a\n');
    onChange.mockClear();
    onHistoryChange.mockClear();
    editor.reset(K8S + '# a\n');
    expect(onChange).not.toHaveBeenCalled();
    expect(onHistoryChange).toHaveBeenCalledWith({ canUndo: false, canRedo: false });
    expect(editor.canUndo()).toBe(false);
  });

  it('canUndo()/canRedo() mirror the store, also while read-only', async () => {
    const { editor } = await mount({ value: K8S });
    expect([editor.canUndo(), editor.canRedo()]).toEqual([false, false]);
    editor.setValue(K8S + '# a\n');
    expect([editor.canUndo(), editor.canRedo()]).toEqual([true, false]);
    editor.undo();
    expect([editor.canUndo(), editor.canRedo()]).toEqual([false, true]);
    editor.setReadOnly(true);
    expect([editor.canUndo(), editor.canRedo()]).toEqual([false, true]);
  });
});

describe('format signals', () => {
  it('onFormatChange reports detection under auto', async () => {
    const calls: (string | undefined)[] = [];
    await mount({ value: COMPOSE, onFormatChange: (f) => calls.push(f) });
    expect(calls).toEqual(['compose']);
  });

  it('onFormatChange follows setValue under auto and ignores same-format text', async () => {
    const calls: (string | undefined)[] = [];
    const { editor } = await mount({ value: COMPOSE, onFormatChange: (f) => calls.push(f) });
    editor.setValue(K8S);
    expect(calls).toEqual(['compose', 'kubernetes']);
    editor.setValue(K8S + '# c\n');
    expect(calls).toEqual(['compose', 'kubernetes']);
    editor.setValue(COMPOSE);
    editor.setValue(COMPOSE2);
    expect(calls).toEqual(['compose', 'kubernetes', 'compose']);
  });

  it("onFormatChange fires for setFormat to a fixed id and not for setFormat('auto') that resolves to the same format", async () => {
    const calls: (string | undefined)[] = [];
    const { editor } = await mount({ value: K8S, onFormatChange: (f) => calls.push(f) });
    expect(calls).toEqual(['kubernetes']);
    editor.setFormat('compose');
    expect(calls).toEqual(['kubernetes', 'compose']);
    editor.setFormat('kubernetes');
    expect(calls).toEqual(['kubernetes', 'compose', 'kubernetes']);
    editor.setFormat('auto');
    expect(calls).toEqual(['kubernetes', 'compose', 'kubernetes']);
  });

  it('R16: undo of typed text under auto keeps the format', async () => {
    const onFormatChange = vi.fn();
    const { editor, fake } = await mount({ value: K8S, onFormatChange });
    expect(editor.getActiveFormat()).toBe('kubernetes');
    onFormatChange.mockClear();
    fake.type(COMPOSE);
    expect(editor.getActiveFormat()).toBe('kubernetes');
    editor.undo();
    expect(editor.getValue()).toBe(K8S);
    expect(editor.getActiveFormat()).toBe('kubernetes');
    editor.redo();
    expect(editor.getValue()).toBe(COMPOSE);
    expect(editor.getActiveFormat()).toBe('kubernetes');
    expect(onFormatChange).not.toHaveBeenCalled();
  });

  it('R16: undo of an API setValue re-detects', async () => {
    const { editor } = await mount({ value: K8S });
    editor.setValue(COMPOSE);
    expect(editor.getActiveFormat()).toBe('compose');
    editor.undo();
    expect(editor.getActiveFormat()).toBe('kubernetes');
    editor.redo();
    expect(editor.getActiveFormat()).toBe('compose');
  });
});

describe('after destroy', () => {
  it('no signal after destroy', async () => {
    const onFormatChange = vi.fn();
    const onHistoryChange = vi.fn();
    const { editor } = await mount({ value: K8S, onFormatChange, onHistoryChange });
    editor.setValue(K8S + '# a\n');
    editor.destroy();
    onFormatChange.mockClear();
    onHistoryChange.mockClear();
    editor.setValue(COMPOSE);
    editor.setFormat('compose');
    editor.clearHistory();
    editor.reset(COMPOSE);
    editor.setReadOnly(true);
    expect(onFormatChange).not.toHaveBeenCalled();
    expect(onHistoryChange).not.toHaveBeenCalled();
    expect(editor.canUndo()).toBe(false);
  });
});
