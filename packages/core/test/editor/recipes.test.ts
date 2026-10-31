// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { createRecipeCards } from '../../src/editor/recipes.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition, Recipe, SchemaBundle } from '../../src/formats/types.js';
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

  it('choosing any built-in recipe in the editor leaves zero error problems', async () => {
    for (const recipe of [...kubernetesFormat.recipes!, ...composeFormat.recipes!]) {
      const { editor } = await mount({ format: 'auto' });
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        cards().find((b) => b.getAttribute('data-sw-recipe') === recipe.id)!.click();
        await vi.advanceTimersByTimeAsync(250); // past the validation debounce (the format change validates at once)
        expect(editor.getProblems().filter((p) => p.severity === 'error'), recipe.id).toEqual([]);
        expect(editor.getValue()).toBe(recipe.yaml);
      } finally {
        vi.useRealTimers();
        editor.destroy();
      }
    }
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

  it('a host recipe for an unknown format is dropped with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const yaml = 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: demo\n';
    const stray: Recipe = { id: 'stray', format: 'kubernets', title: 'Stray', description: 'A typo in the format', yaml };
    const mine: Recipe = { id: 'mine', format: 'kubernetes', title: 'Mine', description: 'Host recipe', yaml };
    const { editor } = await mount({ format: 'auto', recipes: [stray, mine] });
    expect(ids()).toContain('mine');
    expect(ids()).not.toContain('stray');
    expect(warn).toHaveBeenCalledExactlyOnceWith('stack-weaver: recipe "stray" names an unknown format "kubernets"; it is not offered');
    editor.setValue('a: 1\n');
    editor.setValue('');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('a host recipe for a host format is kept', async () => {
    const warn = vi.spyOn(console, 'warn');
    const mine: FormatDefinition = { ...composeFormat, id: 'mine', label: 'Mine', recipes: [] };
    const recipe: Recipe = { id: 'm', format: 'mine', title: 'M', description: 'M', yaml: 'services: {}\n' };
    await mount({ format: 'mine', formats: [mine], recipes: [recipe] });
    expect(ids()).toEqual(['m']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('every built-in recipe detects as its own format', async () => {
    // An auto editor showing the other format switches to the recipe's own format when the host sets its text.
    const { editor } = await mount({ format: 'auto' });
    for (const recipe of [...kubernetesFormat.recipes!, ...composeFormat.recipes!]) {
      editor.setValue(recipe.format === 'kubernetes' ? 'services: {}\n' : 'apiVersion: v1\nkind: Namespace\n');
      expect(editor.getActiveFormat()).not.toBe(recipe.format);
      editor.setValue(recipe.yaml);
      expect(editor.getActiveFormat(), recipe.id).toBe(recipe.format);
    }
  });

  it('never renders recipe text as markup', async () => {
    const evil: Recipe = { id: 'evil', format: 'kubernetes', title: '<img src=x>', description: '<b>x</b>', yaml: 'a: 1\n' };
    await mount({ format: 'kubernetes', recipes: [evil] });
    expect(el.querySelector('.sw-recipes img')).toBeNull();
    expect(el.querySelector('.sw-recipes b')).toBeNull();
  });
});

describe('recipe focus in the visual pane', () => {
  const recipeInput = (r: Recipe): HTMLElement | null => {
    const key = String(r.focus!.path[r.focus!.path.length - 1]);
    return el.querySelector<HTMLElement>(`.sw-section .sw-row[data-sw-key="${key}"] input, .sw-section .sw-row[data-sw-key="${key}"] select`);
  };

  for (const mode of ['visual', 'split'] as const) {
    it(`choosing a recipe in ${mode} focuses the widget at recipe.focus`, async () => {
      await mount({ format: 'kubernetes', mode });
      const recipe = kubernetesFormat.recipes!.find((r) => r.id === 'k8s-web-app')!;
      cards().find((b) => b.getAttribute('data-sw-recipe') === recipe.id)!.click();
      await vi.waitFor(() => {
        const input = recipeInput(recipe);
        expect(input).not.toBeNull();
        expect(document.activeElement).toBe(input);
      });
    });
  }

  it('choosing a recipe in code mode does not move focus into the hidden visual pane', async () => {
    await mount({ format: 'kubernetes', mode: 'code' });
    cards()[0]!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(el.querySelector('.sw-pane-visual')!.contains(document.activeElement)).toBe(false);
  });

  it('a recipe focus made stale while the schema loads is dropped', async () => {
    let resolve!: (b: SchemaBundle | undefined) => void;
    let calls = 0;
    const custom: FormatDefinition = {
      id: 'custom',
      label: 'Custom',
      version: '1',
      rootModel: 'mapping',
      detect: () => false,
      kinds: () => [],
      loadSchema: () => {
        calls++;
        return new Promise<SchemaBundle | undefined>((r) => (resolve = r));
      },
      guide: { groups: [], kinds: {}, fields: {} },
    };
    const recipe: Recipe = { id: 'c', format: 'custom', title: 'C', description: 'd', yaml: 'svc:\n  name: x\n', focus: { doc: 0, path: ['svc', 'name'] } };
    // `ready` waits for the first validation, which waits for the schema: do not await it.
    const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'custom', formats: [custom], recipes: [recipe], mode: 'visual' });
    await vi.waitFor(() => expect(el.querySelector('[data-sw-recipe="c"]')).not.toBeNull());
    el.querySelector<HTMLButtonElement>('[data-sw-recipe="c"]')!.click();
    await vi.waitFor(() => expect(calls).toBeGreaterThan(0));
    made.editor.setValue('svc:\n  name: y\n'); // the user changes the text meanwhile
    resolve({
      id: 'custom',
      schema: { type: 'object', properties: { svc: { type: 'object', properties: { name: { type: 'string' } } } } },
      validate: () => [],
    });
    await vi.waitFor(() => expect(el.querySelector('.sw-row input')).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(el.querySelector('.sw-pane-visual')!.contains(document.activeElement)).toBe(false);
  });

  it('the Secret recipe focuses a control inside the visual pane', async () => {
    await mount({ format: 'kubernetes', mode: 'visual' });
    cards().find((b) => b.getAttribute('data-sw-recipe') === 'k8s-config')!.click();
    await vi.waitFor(() => {
      const a = document.activeElement as HTMLElement | null;
      expect(a?.matches('input, textarea, select')).toBe(true);
      expect(el.querySelector('.sw-pane-visual')!.contains(a)).toBe(true);
    });
  });
});

describe('choosing a recipe whose format is not loaded', () => {
  it('choosing a recipe whose format is not loaded warns once and still inserts the text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = await mount({ format: 'kubernetes' });
    const gone: FormatDefinition = { ...composeFormat, id: 'gone', label: 'Gone', recipes: [] };
    let loaded: readonly FormatDefinition[] = [gone];
    const recipe: Recipe = { id: 'r1', format: 'gone', title: 'T', description: 'D', yaml: 'x: 1\n' };
    const root = document.createElement('div');
    document.body.append(root);
    const fixFormat = vi.fn();
    const cards = createRecipeCards(ctx, { root, auto: () => true, formats: () => loaded, hostRecipes: [recipe], knownFormats: new Set(['gone']), fixFormat, focusCode: () => {} });
    cards.refresh();
    loaded = []; // the format went away after the cards were drawn
    const click = () => root.querySelector<HTMLButtonElement>('button[data-sw-recipe="r1"]')!.click();
    click();
    expect(ctx.store.text).toBe('x: 1\n');
    expect(fixFormat).not.toHaveBeenCalled();
    ctx.store.setText('', 'api');
    click();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"gone"'));
    root.remove();
  });

  it('two recipes of the same missing format each warn once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = await mount({ format: 'kubernetes' });
    // Ids no other test uses: the warning is told once per page.
    const vanished: FormatDefinition = { ...composeFormat, id: 'vanished', label: 'Vanished', recipes: [] };
    let loaded: readonly FormatDefinition[] = [vanished];
    const recipe = (id: string): Recipe => ({ id, format: 'vanished', title: id, description: 'D', yaml: 'x: 1\n' });
    const root = document.createElement('div');
    document.body.append(root);
    const cards = createRecipeCards(ctx, { root, auto: () => true, formats: () => loaded, hostRecipes: [recipe('v1'), recipe('v2')], knownFormats: new Set(['vanished']), fixFormat: vi.fn(), focusCode: () => {} });
    cards.refresh();
    loaded = [];
    for (const id of ['v1', 'v1', 'v2', 'v2']) {
      root.querySelector<HTMLButtonElement>(`button[data-sw-recipe="${id}"]`)!.click();
      ctx.store.setText('', 'api'); // empty again, so the cards come back
    }
    expect(warn.mock.calls.map(([message]) => String(message).match(/recipe "(\w+)"/)?.[1])).toEqual(['v1', 'v2']);
    root.remove();
  });
});
