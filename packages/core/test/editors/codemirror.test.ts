// @vitest-environment happy-dom
import { forEachDiagnostic } from '@codemirror/lint';
import { acceptCompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { expect, it } from 'vitest';
import { codemirrorAdapter } from '../../src/editors/codemirror/index.js';
import { hoverTooltipFor } from '../../src/editors/codemirror/hover.js';
import type { CodeDiagnostic } from '../../src/editors/adapter.js';
import { runAdapterContract, type Mounted } from './adapter-contract.js';

const viewOf = (m: Mounted): EditorView => {
  const view = EditorView.findFromDOM(m.el.querySelector('.cm-editor') as HTMLElement);
  if (!view) throw new Error('no EditorView in the mounted element');
  return view;
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
  keyTarget: (m) => viewOf(m).contentDOM,
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

const noop = { onChange: () => {}, onUndo: () => {}, onRedo: () => {} };

it('maps CodeCompletion fields and applies the apply text at from', async () => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const inst = codemirrorAdapter().mount(el, {
    ...noop, text: 'ap', readOnly: false, theme: 'light', ariaLabel: 'x',
    complete: () => ({
      from: 0,
      options: [{ label: 'apiVersion', apply: 'apiVersion: ', detail: 'required', info: 'The API version', section: { name: 'Recommended', rank: 0 }, boost: 10 }],
    }),
  });
  const view = viewOf({ el, inst });
  view.dispatch({ selection: EditorSelection.cursor(2) });
  startCompletion(view);
  await until(() => currentCompletions(view.state).length > 0);
  const [c] = currentCompletions(view.state);
  expect(c).toMatchObject({ label: 'apiVersion', apply: 'apiVersion: ', detail: 'required', info: 'The API version', boost: 10 });
  expect((c?.section as { name: string; rank: number }).name).toBe('Recommended');
  await new Promise((r) => setTimeout(r, 120)); // past the completion list's interaction delay
  expect(acceptCompletion(view)).toBe(true);
  expect(view.state.doc.toString()).toBe('apiVersion: ');
  inst.destroy();
});

it('hover tooltip renders title and description as literal text', () => {
  const tip = hoverTooltipFor(
    { from: 0, to: 3, title: '<img onerror=x>', description: '<b>bold</b> & more', required: false },
    document,
  );
  const { dom } = tip.create({} as EditorView);
  expect(dom.querySelector('img, b')).toBeNull();
  expect(dom.children).toHaveLength(2);
  expect(dom.children[0]?.textContent).toBe('<img onerror=x>');
  expect(dom.children[1]?.textContent).toBe('<b>bold</b> & more');
  expect([tip.pos, tip.end]).toEqual([0, 3]);
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
