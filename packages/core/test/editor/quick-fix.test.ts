// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

let el: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const UNDECLARED = 'services:\n  web:\n    image: nginx\n    ports:\n      - "${PORT}:80"\n';

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'compose', value: UNDECLARED, ...options });
  await made.editor.ready;
  await vi.advanceTimersByTimeAsync(1000);
  return { ...made, fake: adapter.last! };
}
const fixButton = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('.sw-problem-fix')!;

describe('quick fixes', () => {
  it('panel: a fixable problem has a Fix button named by fix.label; clicking applies it', async () => {
    const { editor } = await mount();
    const problem = editor.getProblems().find((p) => p.fix)!;
    const item = fixButton().closest('li')!;
    expect(fixButton().textContent).toBe(problem.fix!.label);
    // a sibling of the problem button, never nested in it
    expect([...item.children].map((c) => c.className)).toEqual(['sw-problem', 'sw-problem-fix']);
    expect(fixButton().closest('.sw-problem')).toBeNull();
    const described = el.querySelector(`#${fixButton().getAttribute('aria-describedby')}`)!;
    expect(described.textContent).toBe(problem.message);
    fixButton().click();
    expect(editor.getValue()).toContain('x-variables:');
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
  });

  it('panel: focus lands on the problems toggle after the fix removes the item', async () => {
    await mount();
    fixButton().focus();
    fixButton().click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.querySelector('.sw-problem-fix')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.sw-problems-toggle'));
  });

  it('row: the visual row of an undeclared placeholder shows the fix and applying it declares the variable', async () => {
    const { editor } = await mount({ mode: 'visual' });
    const rowFix = el.querySelector<HTMLButtonElement>('.sw-row .sw-row-fix')!;
    expect(rowFix).not.toBeNull();
    expect(rowFix.textContent).toBe(editor.getProblems().find((p) => p.fix)!.fix!.label);
    expect(el.querySelector(`#${rowFix.getAttribute('aria-describedby')}`)?.textContent).toContain('PORT');
    rowFix.click();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
  });

  it('code pane: the fake adapter receives a diagnostic with one action labelled fix.label; apply() applies the fix', async () => {
    const { editor, fake } = await mount();
    const problem = editor.getProblems().find((p) => p.fix)!;
    const withFix = fake.diagnostics.find((d) => d.message === problem.message)!;
    expect(withFix.actions?.map((a) => a.label)).toEqual([problem.fix!.label]);
    withFix.actions![0]!.apply();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
  });

  it('read-only: fix buttons are disabled, and follow setReadOnly', async () => {
    const { editor } = await mount({ readOnly: true, mode: 'split' });
    expect(fixButton().disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('.sw-row-fix')!.disabled).toBe(true);
    editor.setReadOnly(false);
    expect(fixButton().disabled).toBe(false);
    editor.setReadOnly(true);
    expect(fixButton().disabled).toBe(true);
    fixButton().click();
    expect(editor.getValue()).toBe(UNDECLARED);
  });
});
