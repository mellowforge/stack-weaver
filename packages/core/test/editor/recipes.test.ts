// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { Recipe } from '../../src/formats/types.js';
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

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, ...options });
  await made.editor.ready;
  return { ...made, adapter, fake: adapter.last! };
}
const cards = (): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('.sw-recipes button[data-sw-recipe]')];
const ids = (): (string | null)[] => cards().map((b) => b.getAttribute('data-sw-recipe'));
const root = (): HTMLElement => el.querySelector<HTMLElement>('.sw-recipes')!;

describe('recipe cards', () => {
  it('empty document shows recipe cards for the format', async () => {
    await mount({ format: 'kubernetes' });
    expect(root().hidden).toBe(false);
    expect(ids().sort()).toEqual(kubernetesFormat.recipes!.map((r) => r.id).sort());
    const first = cards()[0]!;
    const recipe = kubernetesFormat.recipes!.find((r) => r.id === first.getAttribute('data-sw-recipe'))!;
    expect(first.textContent).toContain(recipe.title);
    expect(first.textContent).toContain(recipe.description);
  });

  it('auto + empty shows recipes of every format, grouped by format label', async () => {
    await mount({ format: 'auto' });
    const groups = [...el.querySelectorAll('.sw-recipes-group')];
    expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual(['Kubernetes', 'Docker Compose']);
    expect(ids()).toHaveLength(kubernetesFormat.recipes!.length + composeFormat.recipes!.length);
  });

  it('whitespace-only and comment-only text count as empty', async () => {
    await mount({ format: 'kubernetes', value: '  \n\n' });
    expect(root().hidden).toBe(false);
    el.replaceChildren();
    await mount({ format: 'kubernetes', value: '# nothing yet\n---\n' });
    expect(root().hidden).toBe(false);
  });

  it('cards are not offered for a non-empty document or a broken one', async () => {
    await mount({ format: 'kubernetes', value: 'a: 1\n' });
    expect(root().hidden).toBe(true);
    el.replaceChildren();
    await mount({ format: 'kubernetes', value: 'a: [\n' });
    expect(root().hidden).toBe(true);
  });

  it('cards appear when the text becomes empty and go when it is filled', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: 'a: 1\n' });
    expect(root().hidden).toBe(true);
    editor.setValue('');
    expect(root().hidden).toBe(false);
    editor.setValue('a: 1\n');
    expect(root().hidden).toBe(true);
  });

  it('are hidden while read-only', async () => {
    const { editor } = await mount({ format: 'kubernetes', readOnly: true });
    expect(root().hidden).toBe(true);
    editor.setReadOnly(false);
    expect(root().hidden).toBe(false);
  });

  it("choosing a recipe sets text with origin 'api', fixes the format and reveals focus in code", async () => {
    const onChange = vi.fn();
    const { editor, ctx, fake } = await mount({ format: 'auto', onChange });
    const recipe = composeFormat.recipes!.find((r) => r.id === 'compose-web-app')!;
    cards().find((b) => b.getAttribute('data-sw-recipe') === recipe.id)!.click();
    expect(editor.getValue()).toBe(recipe.yaml);
    expect(onChange).toHaveBeenCalledWith(recipe.yaml, { origin: 'api' });
    expect(ctx.format()?.id).toBe('compose');
    expect(el.querySelector('.sw-format-badge')!.textContent).toContain('Docker Compose');
    const view = describeNode(ctx.store.parsed, recipe.focus!)!;
    expect(fake.revealed).toEqual({ range: view.keyRange ?? view.range, select: true });
    expect(root().hidden).toBe(true);
  });

  it('Start blank hides cards and focuses code', async () => {
    const { fake } = await mount({ format: 'kubernetes' });
    const focus = vi.spyOn(fake, 'focus');
    el.querySelector<HTMLButtonElement>('button.sw-recipes-blank')!.click();
    expect(root().hidden).toBe(true);
    expect(focus).toHaveBeenCalled();
  });

  it('after Start blank the cards return only once the text was filled and emptied again', async () => {
    const { editor, fake } = await mount({ format: 'kubernetes' });
    el.querySelector<HTMLButtonElement>('button.sw-recipes-blank')!.click();
    fake.type('  ');
    expect(root().hidden).toBe(true);
    fake.type('a: 1\n');
    editor.setValue('');
    expect(root().hidden).toBe(false);
  });

  it('host recipes add to built-ins and replace by id', async () => {
    const yaml = 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: demo\n';
    const mine: Recipe = { id: 'mine', format: 'kubernetes', title: 'Mine', description: 'Host recipe', yaml };
    const over: Recipe = { id: 'k8s-worker', format: 'kubernetes', title: 'Replaced', description: 'Replaced worker', yaml };
    await mount({ format: 'kubernetes', recipes: [mine, over] });
    expect(ids()).toContain('mine');
    expect(ids().filter((i) => i === 'k8s-worker')).toHaveLength(1);
    expect(cards().find((b) => b.getAttribute('data-sw-recipe') === 'k8s-worker')!.textContent).toContain('Replaced');
    expect(ids()).toHaveLength(kubernetesFormat.recipes!.length + 1);
  });

  it('never renders recipe text as markup', async () => {
    const evil: Recipe = { id: 'evil', format: 'kubernetes', title: '<img src=x>', description: '<b>x</b>', yaml: 'a: 1\n' };
    await mount({ format: 'kubernetes', recipes: [evil] });
    expect(el.querySelector('.sw-recipes img')).toBeNull();
    expect(el.querySelector('.sw-recipes b')).toBeNull();
  });
});
