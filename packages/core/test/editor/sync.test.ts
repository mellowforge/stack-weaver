// @vitest-environment happy-dom
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { CodeEditorAdapter, CodeEditorInit } from '../../src/editors/adapter.js';
import { codemirrorAdapter } from '../../src/editors/codemirror/index.js';
import { hoverSource } from '../../src/editors/codemirror/hover.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);

let el: HTMLElement;
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  consoleError = vi.spyOn(console, 'error');
});
afterEach(() => {
  // The code pane's safety net (a full replace when the editor and the store disagree) must never fire.
  expect(consoleError.mock.calls.filter(([m]) => String(m).includes('out of sync'))).toEqual([]);
  vi.useRealTimers();
  el.remove();
  vi.restoreAllMocks();
});

/** The editor with the real CodeMirror adapter (the code pane mounts it once `ready` resolves). */
async function mount(value = DEPLOY, options: Partial<ManifestEditorOptions> = {}) {
  let init: CodeEditorInit | undefined;
  const real = codemirrorAdapter();
  const codeEditor: CodeEditorAdapter = {
    mount(target, i) {
      init = i;
      return real.mount(target, i);
    },
  };
  const made = createEditorWithContext(el, { codeEditor, format: 'kubernetes', mode: 'split', value, ...options });
  await made.editor.ready;
  const view = EditorView.findFromDOM(el.querySelector('.cm-editor') as HTMLElement);
  if (!view || !init) throw new Error('CodeMirror is not mounted');
  return { ...made, view, init };
}

const pressMod = (view: EditorView, key: string, shiftKey = false): void => {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: shiftKey ? key.toUpperCase() : key,
      keyCode: key.toUpperCase().charCodeAt(0),
      shiftKey,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    }),
  );
};

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
      const c = (spec as { changes?: { from: number; to: number; insert: { toString(): string } } }).changes;
      return c ? [{ from: c.from, to: c.to, insert: c.insert.toString() }] : [];
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

describe('redo and mixed history across panes', () => {
  const shown = () => el.querySelector<HTMLInputElement>('.sw-section .sw-row[data-sw-key="replicas"] input')?.value;

  it('Mod-Shift-z and Mod-y in code redo into both panes', async () => {
    const { ctx, editor, view } = await mount();
    editor.reveal({ doc: 0, path: ['spec'] });
    ctx.store.edit({ op: 'set', at: replicasAt, value: 3 });
    const three = DEPLOY.replace('replicas: 2', 'replicas: 3');

    pressMod(view, 'z');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([DEPLOY, DEPLOY, '2']);
    pressMod(view, 'z', true);
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([three, three, '3']);
    pressMod(view, 'z');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([DEPLOY, DEPLOY, '2']);
    pressMod(view, 'y');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([three, three, '3']);
  });

  it('a code edit then a visual edit undo one step at a time in both panes', async () => {
    const { ctx, editor, view } = await mount();
    editor.reveal({ doc: 0, path: ['spec'] });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const at = DEPLOY.indexOf('2\n');
    view.dispatch({ changes: { from: at, to: at + 1, insert: '5' }, userEvent: 'input.type' });
    vi.advanceTimersByTime(101);
    const five = DEPLOY.replace('replicas: 2', 'replicas: 5');
    expect([ctx.store.text, shown()]).toEqual([five, '5']);
    ctx.store.edit({ op: 'set', at: replicasAt, value: 7 });
    const seven = DEPLOY.replace('replicas: 2', 'replicas: 7');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([seven, seven, '7']);

    pressMod(view, 'z');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([five, five, '5']);
    pressMod(view, 'z');
    expect([ctx.store.text, view.state.sliceDoc(), shown()]).toEqual([DEPLOY, DEPLOY, '2']);
  });

  it('undo from broken text to valid text clears the banner', async () => {
    const { ctx, view } = await mount();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const banner = el.querySelector<HTMLElement>('.sw-banner')!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'bad: [\n' }, userEvent: 'input.type' });
    vi.advanceTimersByTime(101);
    expect(ctx.store.parsed.ok).toBe(false);
    expect(banner.hidden).toBe(false);

    pressMod(view, 'z');
    expect(ctx.store.text).toBe(DEPLOY);
    expect(banner.hidden).toBe(true);
  });
});

describe('CRLF documents with the real CodeMirror adapter', () => {
  const CRLF = DEPLOY.replace(/\n/g, '\r\n');

  it('a visual edit keeps CRLF and reaches CodeMirror as a minimal change', async () => {
    const onChange = vi.fn();
    const { ctx, view } = await mount(CRLF, { onChange });
    const dispatch = vi.spyOn(view, 'dispatch');

    expect(ctx.store.edit({ op: 'set', at: replicasAt, value: 3 }).ok).toBe(true);

    const expected = CRLF.replace('replicas: 2', 'replicas: 3');
    expect(ctx.store.text).toBe(expected);
    expect(view.state.sliceDoc()).toBe(expected);
    expect(onChange).toHaveBeenLastCalledWith(expected, { origin: 'visual' });
    const changes = dispatch.mock.calls.flatMap(([spec]) => {
      const c = (spec as { changes?: { from: number; to: number; insert: { toString(): string } } }).changes;
      return c ? [{ from: c.from, to: c.to, insert: c.insert.toString() }] : [];
    });
    const at = DEPLOY.indexOf('2\n'); // CodeMirror counts each line break as one position
    expect(changes).toEqual([{ from: at, to: at + 1, insert: '3' }]);
  });

  it('typing one key keeps CRLF, and a visual edit afterwards is not reverted', async () => {
    const { ctx, view } = await mount(CRLF);
    const at = DEPLOY.indexOf('web') + 3;
    view.dispatch({ changes: { from: at, insert: 's' }, userEvent: 'input.type' });
    const typed = CRLF.replace('name: web', 'name: webs');
    expect(ctx.store.text).toBe(typed);

    ctx.store.edit({ op: 'set', at: replicasAt, value: 4 });
    const both = typed.replace('replicas: 2', 'replicas: 4');
    expect(view.state.sliceDoc()).toBe(both);
    view.dispatch({ changes: { from: at + 1, insert: 'x' }, userEvent: 'input.type' });
    expect(ctx.store.text).toBe(both.replace('name: webs', 'name: websx'));
  });

  it('completion offers keys on a CRLF document', async () => {
    const { view } = await mount(`${CRLF}  `);
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    startCompletion(view);
    for (let i = 0; i < 100 && currentCompletions(view.state).length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(currentCompletions(view.state).map((c) => c.label)).toContain('selector');
  });

  it('hover answers on a CRLF document, at the CodeMirror position of the key', async () => {
    const { view, init } = await mount(CRLF);
    const pos = DEPLOY.indexOf('replicas') + 2;
    const tip = await hoverSource(init.hover!)(view, pos);
    expect(tip).not.toBeNull();
    expect([tip!.pos, tip!.end]).toEqual([DEPLOY.indexOf('replicas'), DEPLOY.indexOf('replicas') + 'replicas'.length]);
  });
});
