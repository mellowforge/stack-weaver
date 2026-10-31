import { describeNode } from '../document/describe.js';
import type { NodeView } from '../document/describe.js';
import type { NodeRef, ParsedText, YamlValue } from '../document/types.js';
import type { EditorContext } from '../editor/context.js';
import { h } from '../editor/dom.js';
import type { Problem } from '../validation/problems.js';
import { makeLabelFor } from './labels.js';
import { isRecord, safeData } from './util.js';
import { formatMessage } from '../editor/format-message.js';

/** What a field row is built from. */
export interface FieldRowInit {
  /** The child node. */
  readonly ref: NodeRef;
  /** The key in a mapping, or the index in a sequence. */
  readonly key: string | number;
  /** The child's description when the row was created. */
  readonly view: NodeView;
}

/** A mounted field row: reused by path across updates and destroyed when its path vanishes. */
export interface FieldRowHandle {
  /** The row's element. */
  readonly el: HTMLElement;
  /** Shows the current value; never called with a stale one after `destroy`. */
  update(value: YamlValue, readOnly: boolean, problems: readonly Problem[]): void;
  /** Shows the row's current label (the guide label once the schema has loaded); optional for rows that carry their own. */
  setLabel?(label: string): void;
  /** Moves focus to the row's main control. */
  focus?(): void;
  /** Releases the row. */
  destroy(): void;
}

/**
 * The section's hooks, supplied by `createFieldSlots`: a widget for a field, and the "add" control
 * of a section. Returning `undefined` from `field` keeps the plain read-only row.
 * @internal
 */
export interface SectionSlots {
  /** The widget row for one child of the section, or `undefined` for the default text row. */
  field(row: FieldRowInit): FieldRowHandle | undefined;
  /** Whether a widget edits the mapping at `ref` itself, so the outline does not offer it as a section. */
  manages?(ref: NodeRef): boolean;
  /** The add control shown after the rows, or `undefined`. */
  addSlot(ref: NodeRef): HTMLElement | undefined;
  /** Re-reads the document for the element `addSlot` returned; called by every `update()`. */
  updateAddSlot?(el: HTMLElement): void;
  /** Releases the element `addSlot` returned; called when the section is destroyed. */
  destroyAddSlot?(el: HTMLElement): void;
}

/**
 * A mounted section.
 * @internal
 */
export interface Section {
  /** The `.sw-section` element. */
  readonly el: HTMLElement;
  /** Re-reads the document: reuses rows by path, drops vanished ones, mounts new ones in source order. */
  update(): void;
  /** Focuses the control of the row for child `key`; false when there is no such row or it has nothing to focus. */
  focusRow(key: string | number): boolean;
  /** Releases the section and its rows. */
  destroy(): void;
}

interface Row {
  readonly kind: 'scalar' | 'collection';
  readonly el: HTMLElement;
  update(view: NodeView, label: string, value: YamlValue, readOnly: boolean, problems: readonly Problem[]): void;
  focus?(): void;
  destroy(): void;
}

function valueAt(data: unknown, path: readonly (string | number)[]): unknown {
  let cur = data;
  for (const seg of path) {
    if (typeof seg === 'number') cur = Array.isArray(cur) ? (cur as unknown[])[seg] : undefined;
    else cur = isRecord(cur) ? cur[seg] : undefined;
  }
  return cur;
}

/** Destroys `row`; a throw (from a host widget) is logged, so a loop over the rows goes on to the others. */
function destroyRow(row: Row): void {
  try {
    row.destroy();
  } catch (err) {
    console.error("stack-weaver: a field row's destroy threw", err);
  }
}

const startsWith = (path: readonly (string | number)[], prefix: readonly (string | number)[]): boolean =>
  prefix.every((seg, i) => path[i] === seg);

/**
 * Mounts the section of the mapping or sequence at `ref`: one row per child, in source order. The
 * section is stateful: rows are kept in a map by key and reused by `update()`, so a focused input
 * is never replaced. Without a widget from `slots`, a scalar shows as read-only text and a
 * collection as no row (the outline reaches it).
 * @internal
 */
export function mountSection(ctx: EditorContext, ref: NodeRef, slots: SectionSlots, doc: Document = document): Section {
  const ui = ctx.messages.ui;
  const rowsEl = h(doc, 'div', { class: 'sw-rows' });
  const noteEl = h(doc, 'div', { class: 'sw-section-note', hidden: true });
  const el = h(doc, 'section', { class: 'sw-section' }, [noteEl, rowsEl]);
  const add = slots.addSlot(ref);
  if (add) el.append(add);
  const rows = new Map<string, Row>();

  const textRow = (init: FieldRowInit): Row => {
    const labelEl = h(doc, 'span', { class: 'sw-row-label' });
    const valueEl = h(doc, 'span', { class: 'sw-row-value' });
    const rowEl = h(doc, 'div', { class: 'sw-row', 'data-sw-key': String(init.key) }, [labelEl, valueEl]);
    return {
      kind: 'scalar',
      el: rowEl,
      update(view, label, value) {
        const text = value === null || value === undefined ? '' : String((view.type === 'scalar' ? view.value : undefined) ?? value);
        if (valueEl.textContent !== text) valueEl.textContent = text;
        if (labelEl.textContent !== label) labelEl.textContent = label;
      },
      destroy: () => rowEl.remove(),
    };
  };

  const hasFocus = (node: HTMLElement): boolean => node.contains(doc.activeElement);

  function clear(): void {
    for (const r of rows.values()) destroyRow(r);
    rows.clear();
    noteEl.hidden = true;
  }

  /** The section's note: why it is read-only (a node that cannot be edited visually, or a schema that failed to load), with the way to the code. */
  function showNote(view: NodeView, broken: boolean): void {
    noteEl.replaceChildren();
    noteEl.hidden = true;
    if (broken) return; // the banner already explains, and the ranges belong to the last good text
    const texts = [...(view.readOnly ? [ui.readOnlyNode] : []), ...(ctx.bundleError(ref.doc) !== undefined ? [ui.schemaFailed] : [])];
    if (texts.length === 0) return;
    const link = h(doc, 'button', { type: 'button', class: 'sw-link' }, [ui.editInCode]);
    link.addEventListener('click', () => ctx.editInCode(view.keyRange ?? view.range));
    noteEl.append(...texts.flatMap((t) => [h(doc, 'span', {}, [t]), ' ']), link);
    noteEl.hidden = false;
  }

  function update(): void {
    if (add) slots.updateAddSlot?.(add);
    const { store } = ctx;
    const broken = !store.parsed.ok;
    const parsed: ParsedText | undefined = broken ? store.lastGood : store.parsed;
    const view = parsed ? describeNode(parsed, ref) : undefined;
    if (!parsed || !view || (view.type !== 'map' && view.type !== 'seq')) {
      clear();
      if (view) showNote(view, broken); // an alias: nothing to list, but the way to the code
      return;
    }
    showNote(view, broken);
    const data = safeData(parsed, ref.doc);
    const labelFor = makeLabelFor(ctx, parsed);
    const problems = broken ? [] : ctx.problems();
    const sectionReadOnly = ctx.readOnly() || broken || view.readOnly !== undefined;

    const children: { key: string | number; rowKey: string }[] =
      view.type === 'map'
        ? [...new Set(view.keys ?? [])].map((key) => ({ key, rowKey: `k:${key}` }))
        : Array.from({ length: view.length ?? 0 }, (_, i) => ({ key: i, rowKey: `i:${i}` }));

    const desired: Row[] = [];
    const live = new Set<string>();
    for (const { key, rowKey } of children) {
      const childRef: NodeRef = { doc: ref.doc, path: [...ref.path, key] };
      const cv = describeNode(parsed, childRef);
      if (!cv) continue;
      const kind: Row['kind'] = cv.type === 'scalar' ? 'scalar' : 'collection';
      let row = rows.get(rowKey);
      if (row && row.kind !== kind) {
        destroyRow(row);
        rows.delete(rowKey);
        row = undefined;
      }
      if (!row) {
        const init: FieldRowInit = { ref: childRef, key, view: cv };
        const handle = slots.field(init);
        if (handle) {
          row = {
            kind,
            el: handle.el,
            update: (_v, label, value, readOnly, p) => {
              handle.setLabel?.(label);
              handle.update(value, readOnly, p);
            },
            ...(handle.focus && { focus: () => handle.focus!() }),
            destroy: () => {
              try {
                handle.destroy();
              } finally {
                handle.el.remove();
              }
            },
          };
        } else if (kind === 'scalar') {
          row = textRow(init);
        }
        if (!row) continue; // a collection without a widget: the outline reaches it
        rows.set(rowKey, row);
      }
      live.add(rowKey);
      const value = (cv.type === 'scalar' ? cv.value : valueAt(data, childRef.path)) as YamlValue;
      const rowProblems = problems.filter((p) => p.doc === ref.doc && startsWith(p.path, childRef.path));
      const label = typeof key === 'number' ? formatMessage(ui.itemLabel, { n: key + 1 }) : labelFor(childRef, key);
      row.update(cv, label, value ?? null, sectionReadOnly || cv.readOnly !== undefined, rowProblems);
      desired.push(row);
    }
    for (const [k, r] of [...rows]) {
      if (!live.has(k)) {
        destroyRow(r);
        rows.delete(k);
      }
    }

    // Source order, without moving the row the user is typing in.
    let cursor: ChildNode | null = rowsEl.firstChild;
    for (const row of desired) {
      if (row.el === cursor) cursor = cursor.nextSibling;
      else if (hasFocus(row.el)) cursor = row.el.nextSibling;
      else rowsEl.insertBefore(row.el, cursor);
    }
  }

  update();
  return {
    el,
    update,
    focusRow(key) {
      const row = rows.get(typeof key === 'number' ? `i:${key}` : `k:${key}`);
      if (!row?.focus) return false;
      row.focus();
      return row.el.contains(doc.activeElement);
    },
    destroy() {
      clear();
      if (add) slots.destroyAddSlot?.(add);
      add?.remove();
      el.remove();
    },
  };
}
