// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
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

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const CRD = 'apiVersion: example.io/v1\nkind: Widget\nmetadata:\n  name: w\n';

/** An editor in Visual mode, where the code pane is hidden. */
async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const onModeChange = vi.fn();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'visual', onModeChange, ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0)); // bundle loads started by the pane settle
  const fake = adapter.last!;
  /** The link took the user to the code: split mode, the range selected, the code editor focused. */
  const expectInCode = (range: { from: number; to: number }) => {
    expect(made.editor.getMode()).toBe('split');
    expect(onModeChange).toHaveBeenCalledWith('split');
    expect(el.querySelector<HTMLElement>('.sw-pane-code')!.hidden).toBe(false);
    expect(fake.revealed).toEqual({ range, select: true });
    expect(document.activeElement).toBe(el.querySelector('.sw-pane-code textarea'));
  };
  return { ...made, fake, onModeChange, expectInCode };
}

const outlineClick = (label: string) =>
  [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].find((l) => l.textContent === label)!.click();

describe('"Edit in code" and "Jump to error" in Visual mode open the code', () => {
  it('the banner\'s Jump to error', async () => {
    const { ctx, expectInCode } = await mount({ value: 'a: [\n' });
    el.querySelector<HTMLButtonElement>('.sw-banner-jump')!.click();
    const first = ctx.store.parsed.errors[0]!;
    expectInCode({ from: first.from, to: first.to });
  });

  it('Jump to error uses the current parse, not problems published for an older text', async () => {
    const { ctx, editor, fake } = await mount({ value: 'a: [\n' });
    const stale = editor.getProblems().find((p) => p.code === 'yaml.syntax')!;
    expect(stale).toBeTruthy();
    fake.type('x: 1\ny: 2\nz: 3\nb: {\n'); // within the validation debounce: the published problems still describe the old text
    expect(editor.getProblems()).toContain(stale);
    el.querySelector<HTMLButtonElement>('.sw-banner-jump')!.click();
    const first = ctx.store.parsed.errors[0]!;
    expect(first.from).not.toBe(stale.from);
    expect(fake.revealed?.range).toEqual({ from: first.from, to: first.to });
  });

  it('the unknown-kind card', async () => {
    const { expectInCode } = await mount({ value: `${CRD}---\n${DEPLOY}` });
    outlineClick('Widget w');
    el.querySelector<HTMLButtonElement>('.sw-unknown-kind .sw-link')!.click();
    expectInCode({ from: 0, to: CRD.length });
  });

  it('the read-only section note', async () => {
    const text = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata: { a: b }\n';
    const { ctx, expectInCode } = await mount({ value: text });
    outlineClick('Data');
    el.querySelector<HTMLButtonElement>('.sw-section-note .sw-link')!.click();
    const view = describeNode(ctx.store.parsed, { doc: 0, path: ['data'] })!;
    expectInCode(view.keyRange ?? view.range);
  });

  it('the unknown-field link', async () => {
    const { ctx, expectInCode } = await mount({ value: DEPLOY.replace('replicas: 2', 'replicas: 2\n  foo: 1') });
    outlineClick('spec');
    el.querySelector<HTMLButtonElement>('.sw-row[data-sw-key="foo"] .sw-link')!.click();
    expectInCode(describeNode(ctx.store.parsed, { doc: 0, path: ['spec', 'foo'] })!.range);
  });

  it('the refused-add link', async () => {
    const { ctx, expectInCode } = await mount({ value: DEPLOY });
    outlineClick('spec');
    vi.spyOn(ctx.store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    el.querySelector<HTMLElement>('.sw-section .sw-add-slot [data-sw-add]')!.click();
    el.querySelector<HTMLButtonElement>('.sw-add-error .sw-link')!.click();
    const view = describeNode(ctx.store.parsed, { doc: 0, path: ['spec'] })!;
    expectInCode(view.keyRange ?? view.range);
  });

  it('selecting an outline node in Visual mode does not switch modes', async () => {
    const { editor, onModeChange } = await mount({ value: DEPLOY });
    outlineClick('spec');
    expect(editor.getMode()).toBe('visual');
    expect(onModeChange).not.toHaveBeenCalled();
    expect(el.querySelector<HTMLElement>('.sw-pane-code')!.hidden).toBe(true);
  });

  it('in Code mode the link reveals without a mode change', async () => {
    const { editor, onModeChange, fake, ctx } = await mount({ value: DEPLOY, mode: 'code' });
    ctx.editInCode({ from: 0, to: 3 });
    expect(editor.getMode()).toBe('code');
    expect(onModeChange).not.toHaveBeenCalled();
    expect(fake.revealed).toEqual({ range: { from: 0, to: 3 }, select: true });
  });
});
