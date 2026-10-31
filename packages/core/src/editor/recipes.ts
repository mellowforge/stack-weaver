import { allDocumentsEmpty } from '../document/data.js';
import type { FormatDefinition, Recipe } from '../formats/types.js';
import { rangeForRef } from './context.js';
import type { EditorContext } from './context.js';
import { h } from './dom.js';

/**
 * The empty state: starter recipe cards, offered only while the document is empty.
 * @internal
 */
export interface RecipeCards {
  /** Re-evaluates whether the cards are shown (call after the text, format or read-only state changes). */
  refresh(): void;
}

/** True for blank or whitespace-only text, and for text that parses to only empty documents (comments, bare `---`). */
function isEmptyText(ctx: EditorContext): boolean {
  const { text, parsed } = ctx.store;
  if (text.trim() === '') return true;
  return parsed.ok && allDocumentsEmpty(parsed);
}

/** Built-in recipes plus host recipes; a host recipe with the same id replaces the built-in in place. */
function mergeRecipes(formats: readonly FormatDefinition[], host: readonly Recipe[]): Recipe[] {
  const out: Recipe[] = formats.flatMap((f) => [...(f.recipes ?? [])]);
  for (const r of host) {
    const at = out.findIndex((x) => x.id === r.id);
    if (at >= 0) out[at] = r;
    else out.push(r);
  }
  return out;
}

/**
 * Fills `root` (the shell's `.sw-recipes` element) with a card per recipe and a "Start blank" button.
 *
 * With format `'auto'` every format's recipes are offered, grouped by format label; with a fixed
 * format, only that format's. A host recipe whose `format` is not a known format id is dropped, with one
 * `console.warn`. Choosing a card sets the text (origin `'api'`), fixes the format and
 * reveals the recipe's `focus` in the code editor and, in the visual pane, focuses its widget. "Start blank" hides the cards and focuses the
 * code; they stay hidden until the text has become non-empty and then empty again.
 * @internal
 */
export function createRecipeCards(
  ctx: EditorContext,
  o: {
    root: HTMLElement;
    /** True while the format is detected from the text rather than fixed by the host. */
    auto(): boolean;
    /** The loaded formats; empty until they have loaded. */
    formats(): readonly FormatDefinition[];
    hostRecipes: readonly Recipe[];
    /** The ids of every format the editor can load: a host recipe naming another id is dropped, with a warning. */
    knownFormats: ReadonlySet<string>;
    /** Makes `format` the editor's format. */
    fixFormat(format: FormatDefinition): void;
    /** Moves keyboard focus into the code editor. */
    focusCode(): void;
  },
): RecipeCards {
  const doc = o.root.ownerDocument;
  const hostRecipes = o.hostRecipes.filter((r) => {
    if (o.knownFormats.has(r.format)) return true;
    console.warn(`stack-weaver: recipe "${r.id}" names an unknown format "${r.format}"; it is not offered`);
    return false;
  });
  let dismissed = false;
  let rendered = '';

  function choose(recipe: Recipe): void {
    ctx.store.setText(recipe.yaml, 'api');
    const format = o.formats().find((f) => f.id === recipe.format);
    if (format) o.fixFormat(format);
    // One reveal: `select` shows the node in the code editor and the visual pane; in visual and
    // split mode the focus then lands on the field's widget, once the schema has loaded.
    if (recipe.focus && rangeForRef(ctx.store.parsed, recipe.focus)) {
      ctx.select(recipe.focus);
      ctx.focusField(recipe.focus);
    }
  }

  function render(groups: readonly { format: FormatDefinition; recipes: readonly Recipe[] }[]): void {
    const children: Node[] = [h(doc, 'p', { class: 'sw-recipes-title' }, [ctx.messages.ui.recipesTitle])];
    for (const g of groups) {
      const cards = g.recipes.map((r) => {
        const b = h(doc, 'button', { type: 'button', class: 'sw-recipe', 'data-sw-recipe': r.id }, [
          h(doc, 'span', { class: 'sw-recipe-title' }, [r.title]),
          h(doc, 'span', { class: 'sw-recipe-description' }, [r.description]),
        ]);
        b.addEventListener('click', () => choose(r));
        return b;
      });
      children.push(
        h(doc, 'div', { class: 'sw-recipes-group' }, [
          ...(groups.length > 1 ? [h(doc, 'h3', { class: 'sw-recipes-format' }, [g.format.label])] : []),
          h(doc, 'div', { class: 'sw-recipes-grid' }, cards),
        ]),
      );
    }
    const blank = h(doc, 'button', { type: 'button', class: 'sw-recipes-blank' }, [ctx.messages.ui.recipesBlank]);
    blank.addEventListener('click', () => {
      dismissed = true;
      o.root.hidden = true;
      o.focusCode();
    });
    children.push(blank);
    o.root.replaceChildren(...children);
  }

  return {
    refresh() {
      const empty = isEmptyText(ctx);
      if (!empty) dismissed = false;
      const formats = o.formats();
      const shown = o.auto() ? formats : formats.filter((f) => f.id === ctx.format()?.id);
      const all = mergeRecipes(formats, hostRecipes);
      const groups = shown
        .map((format) => ({ format, recipes: all.filter((r) => r.format === format.id) }))
        .filter((g) => g.recipes.length > 0);
      const visible = empty && !dismissed && !ctx.readOnly() && groups.length > 0;
      o.root.hidden = !visible;
      if (!visible) return;
      const key = JSON.stringify(groups.map((g) => [g.format.id, g.recipes.map((r) => [r.id, r.title, r.description])]));
      if (key === rendered) return;
      rendered = key;
      render(groups);
    },
  };
}
