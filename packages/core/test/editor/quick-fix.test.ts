// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import type { Problem } from '../../src/validation/problems.js';
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
    expect(document.activeElement).toBe(el.querySelector('.sw-problems-toggle'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.querySelector('.sw-problem-fix')).toBeNull();
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
  const visibleFocus = (): Element => {
    const a = document.activeElement!;
    expect(a.isConnected).toBe(true);
    expect(a.closest('[hidden]')).toBeNull();
    return a;
  };

  it('panel: fixing the only problem hides the panel and hands the focus to a visible target', async () => {
    await mount({ mode: 'split' });
    fixButton().focus();
    fixButton().click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(el.querySelector<HTMLElement>('.sw-problems')!.hidden).toBe(true);
    expect(visibleFocus()).toBe(el.querySelector('.sw-mode-radio[data-sw-mode="split"]'));
  });

  it('row: after the fix the focus stays inside the row, not on the removed button', async () => {
    await mount({ mode: 'visual' });
    const rowFix = el.querySelector<HTMLButtonElement>('.sw-row .sw-row-fix')!;
    const row = rowFix.closest('.sw-row')!;
    rowFix.focus();
    rowFix.click();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rowFix.isConnected).toBe(false);
    expect(row.contains(visibleFocus())).toBe(true);
  });

  it('row: the fix is rebuilt when the problem moves, so it never applies a stale problem', async () => {
    const { editor, fake } = await mount({ mode: 'visual' });
    const before = el.querySelector('.sw-row-fix')!;
    const moved = UNDECLARED.replace('image: nginx', 'image: nginx:latest');
    fake.type(moved);
    await vi.advanceTimersByTimeAsync(1000);
    const after = el.querySelector<HTMLButtonElement>('.sw-row-fix')!;
    expect(after).not.toBe(before);
    expect(after.textContent).toBe(before.textContent);
    after.click();
    expect(editor.getValue()).toBe(`${moved}x-variables:\n  PORT:\n    type: string\n`);
  });

  it('a refused fix leaves the focus and the panel item in place', async () => {
    const { editor } = await mount({ mode: 'split' });
    const btn = fixButton();
    btn.focus();
    editor.setReadOnly(true);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(editor.getValue()).toBe(UNDECLARED);
    expect(fixButton()).toBe(btn);
    expect(document.activeElement).toBe(btn);
  });
});

const declOf = (p: Problem | undefined) => (p?.fix?.action.kind === 'declareVariable' ? p.fix.action.decl : undefined);

describe('stale fixes', () => {
  it('a change to the inline default alone republishes the problem, so the fix declares the new default', async () => {
    const text = 'services:\n  web:\n    image: "nginx:${TAG:-1.0}"\n';
    const onProblemsChange = vi.fn();
    const { editor, fake } = await mount({ value: text, mode: 'split', onProblemsChange });
    expect(declOf(editor.getProblems().find((p) => p.fix))?.default).toBe('1.0');
    const calls = onProblemsChange.mock.calls.length;
    fake.type(text.replace('1.0', '2.0'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onProblemsChange).toHaveBeenCalledTimes(calls + 1);
    expect(declOf(editor.getProblems().find((p) => p.fix))?.default).toBe('2.0');
    fixButton().click();
    expect(editor.getVariables()).toEqual([{ name: 'TAG', type: 'string', default: '2.0' }]);
  });

  it.each(['x-variables', 'external'] as const)('a declare fix never overwrites a variable declared since (%s store)', async (store) => {
    const { editor, ctx } = await mount(store === 'external' ? { variables: { store: 'external', value: [] } } : {});
    const stale = editor.getProblems().find((p) => p.fix)!;
    const mine = { name: 'PORT', type: 'number', default: 8080, description: 'mine' } as const;
    expect(ctx.variables()!.set(mine)).toBe(true);
    const text = editor.getValue();
    expect(editor.applyFix(stale)).toBe(false);
    expect(editor.getVariables()).toEqual([mine]);
    expect(editor.getValue()).toBe(text);
  });
});

/** A container in a one-line flow map: the resources fix cannot nest a map in it, so it is refused. */
const FLOW_POD = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - { name: web, image: nginx }\n';
const panelStatus = (): HTMLElement => el.querySelector<HTMLElement>('.sw-problems-status')!;

describe('refused fixes', () => {
  const live = (): Element => {
    const a = document.activeElement!;
    expect(a.isConnected).toBe(true);
    expect(a.closest('[hidden]')).toBeNull();
    return a;
  };

  it('panel: a refused fix says so in an alert outside the list and keeps the focus on the button', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: FLOW_POD });
    const btn = fixButton();
    btn.focus();
    btn.click();
    expect(editor.getValue()).toBe(FLOW_POD);
    expect(panelStatus().getAttribute('role')).toBe('alert');
    expect(panelStatus().textContent).toBe(defaultUiMessages.editRefused);
    expect(panelStatus().closest('.sw-problem-list')).toBeNull();
    expect(live()).toBe(btn);
    // collapsing the list keeps the message visible
    el.querySelector<HTMLButtonElement>('.sw-problems-toggle')!.click();
    expect(panelStatus().closest('[hidden]')).toBeNull();
  });

  it('panel: every refusal is announced again, even with the same text', async () => {
    await mount({ format: 'kubernetes', value: FLOW_POD });
    fixButton().click();
    const seen: MutationRecord[] = [];
    const watch = new MutationObserver((records) => seen.push(...records));
    watch.observe(panelStatus(), { childList: true, characterData: true, subtree: true });
    fixButton().click();
    await Promise.resolve();
    watch.disconnect();
    expect(seen.length).toBeGreaterThan(0);
    expect(panelStatus().textContent).toBe(defaultUiMessages.editRefused);
  });

  it('panel: a stale second fix is refused with the message, which clears once the problems change', async () => {
    const twoUses = 'services:\n  web:\n    image: "${IMG}"\n    command: "${IMG}"\n';
    const { editor } = await mount({ value: twoUses });
    const [first, second] = [...el.querySelectorAll<HTMLButtonElement>('.sw-problem-fix')];
    first!.click();
    const text = editor.getValue();
    // IMG is declared now: the second fix is refused, never applied twice
    second!.click();
    expect(editor.getValue()).toBe(text);
    expect(panelStatus().textContent).toBe(defaultUiMessages.editRefused);
    await vi.advanceTimersByTimeAsync(1000);
    expect(panelStatus().textContent).toBe('');
  });

  it('row: a refused fix shows editRefused in the row error (an alert) and keeps the focus on the button', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: FLOW_POD, mode: 'visual' });
    const rowFix = el.querySelector<HTMLButtonElement>('.sw-row .sw-row-fix')!;
    const error = rowFix.closest('.sw-row')!.querySelector<HTMLElement>('.sw-row-error')!;
    rowFix.focus();
    rowFix.click();
    expect(editor.getValue()).toBe(FLOW_POD);
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe(defaultUiMessages.editRefused);
    expect(live()).toBe(rowFix);
  });

  it('code pane: a refused fix says so in the problems panel', async () => {
    const { editor, fake } = await mount({ format: 'kubernetes', value: FLOW_POD });
    const withFix = fake.diagnostics.find((d) => d.actions)!;
    withFix.actions![0]!.apply();
    expect(editor.getValue()).toBe(FLOW_POD);
    expect(panelStatus().textContent).toBe(defaultUiMessages.editRefused);
  });

  it('code pane: no fix actions while read-only; they follow setReadOnly', async () => {
    const { editor, fake } = await mount({ readOnly: true });
    expect(fake.diagnostics.length).toBeGreaterThan(0);
    expect(fake.diagnostics.some((d) => d.actions)).toBe(false);
    editor.setReadOnly(false);
    expect(fake.diagnostics.some((d) => d.actions)).toBe(true);
    editor.setReadOnly(true);
    expect(fake.diagnostics.some((d) => d.actions)).toBe(false);
  });
});

describe('every entry point under every store', () => {
  type Mounted = Awaited<ReturnType<typeof mount>>;
  const ENTRIES: Record<string, (m: Mounted) => void> = {
    panel: () => fixButton().click(),
    row: () => el.querySelector<HTMLButtonElement>('.sw-row .sw-row-fix')!.click(),
    'code pane': ({ fake }) => fake.diagnostics.find((d) => d.actions)!.actions![0]!.apply(),
  };
  // "${PORT}:80" is not the whole value, so the declaration is a string (R1).
  const DECLARED = `${UNDECLARED}x-variables:\n  PORT:\n    type: string\n`;

  /** The fix applied: the problem is gone; x-variables: the block is in the text and one undo restores it; external: the text is untouched. */
  async function expectFixed({ editor }: Mounted, store: 'x-variables' | 'external'): Promise<void> {
    await vi.advanceTimersByTimeAsync(1000);
    expect(editor.getProblems()).toEqual([]);
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'string' }]);
    if (store === 'external') {
      expect(editor.getValue()).toBe(UNDECLARED);
      return;
    }
    expect(editor.getValue()).toBe(DECLARED);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(UNDECLARED);
  }

  it.each(Object.keys(ENTRIES).flatMap((where) => (['x-variables', 'external'] as const).map((store) => [where, store] as const)))(
    '%s, %s store',
    async (where, store) => {
      const m = await mount({ mode: 'split', ...(store === 'external' ? { variables: { store: 'external', value: [] } } : {}) });
      expect(m.editor.getProblems().map((p) => p.code)).toEqual(['rule.undeclared-variable']);
      ENTRIES[where]!(m);
      await expectFixed(m, store);
    },
  );
});
