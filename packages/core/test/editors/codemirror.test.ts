// @vitest-environment happy-dom
import { forEachDiagnostic } from '@codemirror/lint';
import { currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { undoDepth } from '@codemirror/commands';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { codemirrorAdapter } from '../../src/editors/codemirror/index.js';
import type { CodeDiagnostic } from '../../src/editors/adapter.js';
import { runAdapterContract, type Mounted } from './adapter-contract.js';

const viewOf = (m: Mounted): EditorView => {
  const view = EditorView.findFromDOM(m.el.querySelector('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no EditorView in the mounted element');
  return view;
};
const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
const press = (m: Mounted, init: KeyboardEventInit): void => {
  const view = viewOf(m);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { ...init, keyCode: init.key?.toUpperCase().charCodeAt(0), ctrlKey: !isMac, metaKey: isMac, bubbles: true, cancelable: true }),
  );
};
const until = async (check: () => boolean): Promise<void> => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

runAdapterContract('codemirror adapter', () => ({
  adapter: codemirrorAdapter(),
  type: (m, s) => {
    const view = viewOf(m);
    view.dispatch({ changes: { from: view.state.doc.length, insert: s }, userEvent: 'input.type' });
  },
  setCaret: (m, offset) => viewOf(m).dispatch({ selection: EditorSelection.cursor(offset) }),
  pressUndo: (m) => press(m, { key: 'z' }),
  pressRedo: (m) => press(m, { key: 'Z', shiftKey: true }),
  diagnostics: (m) => {
    const out: CodeDiagnostic[] = [];
    forEachDiagnostic(viewOf(m).state, (d, from, to) => {
      if (d.severity !== 'hint') out.push({ from, to, severity: d.severity, message: d.message });
    });
    return out;
  },
  completions: async (m) => {
    const view = viewOf(m);
    startCompletion(view);
    await until(() => currentCompletions(view.state).length > 0);
    return currentCompletions(view.state).map((c) => c.label);
  },
  ariaLabel: (m) => viewOf(m).contentDOM.getAttribute('aria-label'),
}));

it('Mod-y also calls onRedo', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let redo = 0;
  const inst = codemirrorAdapter().mount(el, {
    text: 'a', readOnly: false, theme: 'light', ariaLabel: 'x',
    onChange: () => {}, onUndo: () => {}, onRedo: () => redo++,
  });
  press({ el, inst }, { key: 'y' });
  expect(redo).toBe(1);
  inst.destroy();
});

it('installs no CodeMirror history (one undo history)', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const inst = codemirrorAdapter().mount(el, {
    text: 'a', readOnly: false, theme: 'light', ariaLabel: 'x',
    onChange: () => {}, onUndo: () => {}, onRedo: () => {},
  });
  const view = viewOf({ el, inst });
  view.dispatch({ changes: { from: 1, insert: 'b' }, userEvent: 'input.type' });
  expect(undoDepth(view.state)).toBe(0);
  expect(view.state.doc.toString()).toBe('ab');
  inst.destroy();
});

it('setTheme toggles the dark theme facet', () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const inst = codemirrorAdapter().mount(el, {
    text: 'a', readOnly: false, theme: 'dark', ariaLabel: 'x',
    onChange: () => {}, onUndo: () => {}, onRedo: () => {},
  });
  expect(viewOf({ el, inst }).state.facet(EditorView.darkTheme)).toBe(true);
  inst.setTheme('light');
  expect(viewOf({ el, inst }).state.facet(EditorView.darkTheme)).toBe(false);
  inst.destroy();
});
