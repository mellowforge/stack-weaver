// @vitest-environment happy-dom
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { codemirrorAdapter } from '../../src/editors/codemirror/index.js';
import { createEditorWithContext } from '../../src/editor/editor.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  vi.useRealTimers();
  el.remove();
  vi.restoreAllMocks();
});

/** The editor with the real CodeMirror adapter (the code pane mounts it once `ready` resolves). */
async function mount() {
  const made = createEditorWithContext(el, { codeEditor: codemirrorAdapter(), format: 'kubernetes', mode: 'split', value: DEPLOY });
  await made.editor.ready;
  const view = EditorView.findFromDOM(el.querySelector('.cm-editor') as HTMLElement);
  if (!view) throw new Error('CodeMirror is not mounted');
  return { ...made, view };
}

const replicasAt = { doc: 0, path: ['spec', 'replicas'] };

describe('split sync with the real CodeMirror adapter', () => {
  it('visual edit appears in code as a minimal change and keeps the code caret', async () => {
    const { ctx, view } = await mount();
    const caret = DEPLOY.indexOf('web') + 1;
    view.dispatch({ selection: EditorSelection.cursor(caret) });
    const dispatch = vi.spyOn(view, 'dispatch');

    const r = ctx.store.edit({ op: 'set', at: replicasAt, value: 3 });
    expect(r.ok).toBe(true);

    expect(view.state.doc.toString()).toBe(DEPLOY.replace('replicas: 2', 'replicas: 3'));
    expect(view.state.doc.toString()).toBe(ctx.store.text);
    const changes = dispatch.mock.calls.flatMap(([spec]) => {
      const c = (spec as { changes?: { from: number; to: number; insert: string } }).changes;
      return c ? [c] : [];
    });
    const at = DEPLOY.indexOf('2\n');
    expect(changes).toEqual([{ from: at, to: at + 1, insert: '3' }]);
    expect(view.state.selection.main.head).toBe(caret);
  });

  it('Mod-z in code undoes a visual edit', async () => {
    const { ctx, editor, view } = await mount();
    editor.reveal({ doc: 0, path: ['spec'] });
    const shown = () => el.querySelector<HTMLInputElement>('.sw-section .sw-row[data-sw-key="replicas"] input')?.value;
    ctx.store.edit({ op: 'set', at: replicasAt, value: 3 });
    expect(shown()).toBe('3');
    const undo = vi.spyOn(ctx.store, 'undo');

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', keyCode: 90, ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true }),
    );

    expect(undo).toHaveBeenCalledTimes(1);
    expect(ctx.store.text).toBe(DEPLOY);
    expect(view.state.doc.toString()).toBe(DEPLOY);
    expect(shown()).toBe('2'); // the visual pane shows the restored value too
  });

  it('code edit appears in visual after 100 ms', async () => {
    const { editor, view } = await mount();
    editor.reveal({ doc: 0, path: ['spec'] });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const shown = () => el.querySelector<HTMLInputElement>('.sw-section .sw-row[data-sw-key="replicas"] input')?.value;
    expect(shown()).toBe('2');

    const at = DEPLOY.indexOf('2\n');
    view.dispatch({ changes: { from: at, to: at + 1, insert: '5' }, userEvent: 'input.type' });
    expect(shown()).toBe('2');
    vi.advanceTimersByTime(99);
    expect(shown()).toBe('2');
    vi.advanceTimersByTime(2);
    expect(shown()).toBe('5');
  });
});
