import { parseText } from '../document/parse.js';
import type { EditorContext } from '../editor/context.js';
import { h } from '../editor/dom.js';
import { firstSentence } from '../engine/addable.js';
import { kindCatalog } from '../engine/catalog.js';
import type { KindCatalog } from '../engine/catalog.js';
import { kindKey } from '../formats/guide.js';
import type { KindEntry } from '../formats/types.js';
import { skeletonFor } from './skeleton.js';

/** The most kinds a search lists. */
const MAX_RESULTS = 60;

/** A kind as the picker shows it: its card text comes from the guide when the kind is curated. */
interface Card {
  readonly entry: KindEntry;
  readonly label: string;
  readonly description: string;
}

/**
 * The root "+ Add resource" control.
 * @internal
 */
export interface AddResource {
  /** The trigger button. */
  readonly el: HTMLButtonElement;
  /** Shows or hides the button for the current format, and enables it when the document can be edited. */
  update(): void;
  /** Closes the picker if it is open. */
  destroy(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled])';

/**
 * Creates the "+ Add resource" button for formats whose root is a list of documents (Kubernetes).
 * Pressing it opens the picker, a modal dialog (APG Dialog (Modal)): intent-grouped cards of
 * curated kinds and a search over every kind. Choosing one inserts a new document built by
 * {@link skeletonFor}; the picker never asks anything else.
 *
 * The kind's schema must be loaded to build the skeleton. The picker loads it through the format
 * (`format.loadSchema`) over a one-document parse of `apiVersion` and `kind`, so any format with
 * `documents` roots works without a kind-specific loader.
 * @internal
 */
export function createAddResource(ctx: EditorContext, doc: Document = document): AddResource {
  const ui = ctx.messages.ui;
  const el = h(doc, 'button', { type: 'button', class: 'sw-btn sw-add-resource', 'aria-haspopup': 'dialog' }, [ui.addResource]);
  let close: (() => void) | undefined;

  function open(): void {
    const format = ctx.format();
    if (!format || close) return;
    const catalog: KindCatalog = kindCatalog(format);
    const curatedByKey = new Map<string, Card>();
    for (const g of catalog.curated) for (const k of g.kinds) curatedByKey.set(kindKey(k.apiVersion, k.kind), { entry: k, label: k.label, description: k.description });
    const cardFor = (entry: KindEntry): Card =>
      curatedByKey.get(kindKey(entry.apiVersion, entry.kind)) ?? { entry, label: entry.kind, description: firstSentence(entry.description) };

    const titleId = `sw-picker-title-${Math.random().toString(36).slice(2, 8)}`;
    const title = h(doc, 'h2', { class: 'sw-picker-title', id: titleId }, [ui.pickerTitle]);
    const closeBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-picker-close', 'aria-label': ui.pickerClose }, ['×']);
    const search = h(doc, 'input', { type: 'search', class: 'sw-input sw-picker-search', 'aria-label': ui.pickerSearch, autocomplete: 'off' });
    const results = h(doc, 'div', { class: 'sw-picker-results' });
    const errorEl = h(doc, 'p', { class: 'sw-field-error sw-picker-error', role: 'alert' });
    const dialog = h(doc, 'div', { class: 'sw-picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
      h(doc, 'div', { class: 'sw-picker-head' }, [title, closeBtn]),
      search,
      results,
      errorEl,
    ]);
    const backdrop = h(doc, 'div', { class: 'sw-picker-backdrop' }, [dialog]);
    let busy = false;

    const card = (c: Card): HTMLButtonElement => {
      const b = h(doc, 'button', { type: 'button', class: 'sw-picker-card', 'data-sw-kind': kindKey(c.entry.apiVersion, c.entry.kind) }, [
        h(doc, 'span', { class: 'sw-picker-card-name' }, [c.label]),
      ]);
      if (c.description !== '') b.append(' ', h(doc, 'span', { class: 'sw-picker-card-desc' }, [c.description]));
      b.addEventListener('click', () => void choose(c.entry));
      return b;
    };

    function renderResults(): void {
      const q = search.value.trim().toLowerCase();
      results.replaceChildren();
      if (q === '') {
        for (const g of catalog.curated) {
          results.append(
            h(doc, 'section', { class: 'sw-picker-group' }, [
              h(doc, 'h3', { class: 'sw-picker-group-title' }, [g.label]),
              h(doc, 'div', { class: 'sw-picker-cards' }, g.kinds.map((k) => card(cardFor(k)))),
            ]),
          );
        }
        return;
      }
      const byName: Card[] = [];
      const byText: Card[] = [];
      for (const entry of catalog.all) {
        const c = cardFor(entry);
        if (entry.kind.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)) byName.push(c);
        else if (c.description.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q)) byText.push(c);
      }
      const hits = [...byName, ...byText].slice(0, MAX_RESULTS);
      if (hits.length === 0) results.append(h(doc, 'p', { class: 'sw-picker-empty' }, [ui.pickerEmpty]));
      else results.append(h(doc, 'div', { class: 'sw-picker-cards' }, hits.map(card)));
    }

    async function choose(entry: KindEntry): Promise<void> {
      if (busy || ctx.readOnly()) return;
      busy = true;
      errorEl.textContent = '';
      try {
        const bundle = await format?.loadSchema(parseText(`apiVersion: ${entry.apiVersion}\nkind: ${entry.kind}\n`), 0);
        if (!close) return; // closed while the schema loaded
        if (!bundle) throw new Error(`no schema for ${kindKey(entry.apiVersion, entry.kind)}`);
        const r = ctx.store.edit({ op: 'addDocument', yaml: skeletonFor(entry, bundle, ctx.guide(), ctx.store.parsed.eol) });
        if (!r.ok) {
          errorEl.textContent = ui.editRefused;
          return;
        }
        close();
        if (r.at) ctx.select(r.at);
      } catch (err) {
        console.error('stack-weaver: adding a resource failed', err);
        if (close) errorEl.textContent = ui.pickerLoadFailed;
      } finally {
        busy = false;
      }
    }

    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = doc.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    });
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close?.();
    });
    closeBtn.addEventListener('click', () => close?.());
    search.addEventListener('input', renderResults);

    close = () => {
      close = undefined;
      backdrop.remove();
      el.focus();
    };
    renderResults();
    (el.closest('.sw-editor') ?? doc.body).append(backdrop);
    search.focus();
  }

  el.addEventListener('click', open);

  return {
    el,
    update() {
      const format = ctx.format();
      el.hidden = format?.rootModel !== 'documents';
      el.disabled = ctx.readOnly() || !ctx.store.parsed.ok;
    },
    destroy() {
      close?.();
    },
  };
}
