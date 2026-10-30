import { describeNode } from '../document/describe.js';
import type { EditOp, EditRefusal } from '../document/edit.js';
import type { NodeRef, YamlPath } from '../document/types.js';
import type { EditorContext } from '../editor/context.js';
import { h } from '../editor/dom.js';
import { addableAt, valueTemplateAt } from '../engine/addable.js';
import type { AddableItem } from '../engine/addable.js';
import { resolveAt } from '../engine/resolve.js';
import { guideFieldOf } from '../formats/guide.js';
import type { Guide, SchemaBundle } from '../formats/types.js';
import { isRecord, safeData } from './util.js';
import { defaultWidgets, pickWidget } from './widgets/registry.js';
import type { WidgetRegistry } from './widgets/types.js';

/** What `update` and `destroy` need of a slot made by {@link renderAddSlot}. */
interface SlotHandle {
  update(): void;
  destroy(): void;
}
const handles = new WeakMap<HTMLElement, SlotHandle>();

let nextId = 0;

/** Compose-spec `x-` extension keys are not a place to add free-form keys. */
const EXTENSION_PATTERN = '^x-';

/**
 * Whether the mapping at `path` takes keys of any name: an `additionalProperties` that is not
 * `false`, or a `patternProperties` other than the `^x-` extension pattern (labels, annotations,
 * a ConfigMap's `data`, compose `services`).
 */
function isFreeForm(bundle: SchemaBundle, path: YamlPath, data: unknown): boolean {
  let schema: Record<string, unknown> | undefined;
  try {
    schema = resolveAt(bundle, path, data)?.schema;
  } catch {
    return false;
  }
  if (!schema) return false;
  const extra = schema['additionalProperties'];
  if (extra === true || isRecord(extra)) return true;
  const patterns = schema['patternProperties'];
  return isRecord(patterns) && Object.keys(patterns).some((p) => p !== EXTENSION_PATTERN);
}

/**
 * Whether the widget picked for the field at `path` declares that it manages the mapping's keys
 * itself (`WidgetFactory.managesKeys`, as the Secret `data` widget does), so its section must not
 * offer to add free-form keys.
 */
function widgetManagesKeys(bundle: SchemaBundle, guide: Guide, registry: WidgetRegistry, path: YamlPath, data: unknown): boolean {
  const key = path[path.length - 1];
  if (typeof key !== 'string') return false;
  try {
    const own = resolveAt(bundle, path, data);
    if (!own) return false;
    const picked = pickWidget(own, guideFieldOf(guide, resolveAt(bundle, path.slice(0, -1), data), key), registry);
    return picked !== undefined && registry[picked.name]?.managesKeys === true;
  } catch {
    return false;
  }
}

/**
 * Re-reads the document for a slot made by {@link renderAddSlot}: what is still missing, and whether
 * the node can be edited. Does nothing for an element that is not a slot.
 * @internal
 */
export function updateAddSlot(el: HTMLElement): void {
  handles.get(el)?.update();
}

/**
 * Releases a slot made by {@link renderAddSlot}.
 * @internal
 */
export function destroyAddSlot(el: HTMLElement): void {
  handles.get(el)?.destroy();
  handles.delete(el);
}

/**
 * The dashed "add here" region at the end of the section at `ref`.
 *
 * - A mapping lists the schema's missing fields: required ones first, then recommended and common,
 *   with advanced ones behind a "Show advanced" disclosure.
 * - A mapping with free-form keys also gets a key input and an "Add key" button, unless the widget
 *   picked for it declares `managesKeys`.
 * - A sequence gets an "Add item" button.
 *
 * The slot is stateful: call {@link updateAddSlot} after the document changes (the section does).
 * @internal
 */
export function renderAddSlot(ctx: EditorContext, ref: NodeRef, doc: Document = document, registry: WidgetRegistry = defaultWidgets): HTMLElement {
  const ui = ctx.messages.ui;
  const id = `sw-add${nextId++}`;
  const groupsEl = h(doc, 'div', { class: 'sw-add-groups' });
  const advancedToggle = h(doc, 'button', { type: 'button', class: 'sw-btn sw-add-advanced-toggle', 'aria-expanded': 'false', 'aria-controls': `${id}-advanced` }, [ui.showAdvanced]);
  const advancedPanel = h(doc, 'div', { class: 'sw-add-advanced', id: `${id}-advanced`, hidden: true });
  const keyInput = h(doc, 'input', { type: 'text', class: 'sw-input sw-add-key-input', 'aria-label': ui.newKeyName, autocomplete: 'off' });
  const keyBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-add-key-btn' }, [ui.addKey]);
  const keyRow = h(doc, 'div', { class: 'sw-add-key' }, [keyInput, keyBtn]);
  const errorEl = h(doc, 'p', { class: 'sw-field-error sw-add-error', role: 'alert' });
  const el = h(doc, 'div', { class: 'sw-add-slot', role: 'group', 'aria-label': ui.addSlotLabel, hidden: true }, [groupsEl, advancedToggle, advancedPanel, errorEl]);

  let expanded = false;
  let sig = '';
  let seqMode = false;
  let destroyed = false;

  const setExpanded = (open: boolean): void => {
    expanded = open;
    advancedToggle.setAttribute('aria-expanded', String(open));
    advancedToggle.textContent = open ? ui.hideAdvanced : ui.showAdvanced;
    advancedPanel.hidden = !open;
  };
  advancedToggle.addEventListener('click', () => setExpanded(!expanded));

  const showError = (reason: EditRefusal): void => {
    errorEl.replaceChildren();
    if (reason === 'duplicate-key') {
      errorEl.append(ui.keyExists);
      return;
    }
    errorEl.append(ui.editRefused, ' ');
    const link = h(doc, 'button', { type: 'button', class: 'sw-link' }, [ui.editInCode]);
    link.addEventListener('click', () => {
      const view = describeNode(ctx.store.parsed.ok ? ctx.store.parsed : (ctx.store.lastGood ?? ctx.store.parsed), ref);
      if (view) ctx.revealRange(view.keyRange ?? view.range);
    });
    errorEl.append(link);
  };

  /** Applies `op`; on success selects the new node and moves focus to its row. */
  const run = (op: EditOp): boolean => {
    errorEl.replaceChildren();
    if (ctx.readOnly()) return false;
    const r = ctx.store.edit(op);
    if (!r.ok) {
      showError(r.reason);
      return false;
    }
    if (r.at) {
      const { at } = r;
      ctx.select(at);
      const last = at.path[at.path.length - 1];
      const section = el.parentElement;
      const row = el.isConnected && section ? [...section.querySelectorAll<HTMLElement>('.sw-row')].find((x) => x.dataset['swKey'] === String(last)) : undefined;
      row?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    }
    return true;
  };

  const current = () => {
    const parsed = ctx.store.parsed.ok ? ctx.store.parsed : ctx.store.lastGood;
    const bundle = ctx.bundleFor(ref.doc);
    return { parsed, bundle, data: parsed ? safeData(parsed, ref.doc) : undefined };
  };

  const addField = (item: AddableItem): void => {
    const { bundle, data } = current();
    const value = bundle ? valueTemplateAt(bundle, ctx.guide(), [...ref.path, item.key!], data) : item.valueTemplate;
    run({ op: 'add', at: ref, key: item.key!, value });
  };

  const addKey = (): void => {
    const name = keyInput.value.trim();
    if (name === '') return;
    const { bundle, data } = current();
    const value = bundle ? valueTemplateAt(bundle, ctx.guide(), [...ref.path, name], data) : '';
    if (run({ op: 'add', at: ref, key: name, value })) keyInput.value = '';
  };
  keyBtn.addEventListener('click', addKey);
  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKey();
    }
  });

  const itemButton = (item: AddableItem, disabled: boolean): HTMLButtonElement => {
    const b = h(doc, 'button', { type: 'button', class: 'sw-btn sw-add-item', 'data-sw-add': item.key!, disabled }, [
      h(doc, 'span', { class: 'sw-add-item-label' }, [`+ ${item.label}`]),
    ]);
    if (item.description !== '') b.append(' ', h(doc, 'span', { class: 'sw-add-item-desc' }, [item.description]));
    b.addEventListener('click', () => addField(item));
    return b;
  };

  const groupLabels: Record<string, string> = { required: ui.required, recommended: ui.tierRecommended, common: ui.tierCommon };

  function update(): void {
    if (destroyed) return;
    const { parsed, bundle, data } = current();
    const view = parsed ? describeNode(parsed, ref) : undefined;
    const editable = !ctx.readOnly() && ctx.store.parsed.ok && view?.readOnly === undefined;
    let items: AddableItem[] = [];
    let freeForm = false;
    if (bundle && view && (view.type === 'map' || view.type === 'seq')) {
      try {
        items = addableAt(bundle, ctx.guide(), ref.path, data);
      } catch {
        items = [];
      }
      freeForm = view.type === 'map' && isFreeForm(bundle, ref.path, data) && !widgetManagesKeys(bundle, ctx.guide(), registry, ref.path, data);
      seqMode = view.type === 'seq';
    }
    const next = JSON.stringify([editable, freeForm, seqMode, items.map((i) => [i.key, i.label, i.description, i.tier, i.required])]);
    if (next === sig) return;
    sig = next;
    errorEl.replaceChildren();

    const disabled = !editable;
    groupsEl.replaceChildren();
    advancedPanel.replaceChildren();
    const tiers = new Map<string, AddableItem[]>();
    const advanced: AddableItem[] = [];
    for (const item of items) {
      if (item.key === null) continue;
      const tier = item.required ? 'required' : item.tier;
      if (tier === 'advanced') advanced.push(item);
      else tiers.set(tier, [...(tiers.get(tier) ?? []), item]);
    }
    for (const tier of ['required', 'recommended', 'common']) {
      const list = tiers.get(tier);
      if (!list) continue;
      groupsEl.append(
        h(doc, 'div', { class: 'sw-add-group', 'data-sw-tier': tier }, [
          h(doc, 'span', { class: 'sw-add-group-label' }, [groupLabels[tier]!]),
          h(doc, 'div', { class: 'sw-add-list' }, list.map((i) => itemButton(i, disabled))),
        ]),
      );
    }
    for (const item of advanced) advancedPanel.append(itemButton(item, disabled));
    advancedToggle.hidden = advanced.length === 0;
    if (advanced.length === 0) setExpanded(false);

    if (seqMode && items.some((i) => i.key === null)) {
      const b = h(doc, 'button', { type: 'button', class: 'sw-btn sw-add-seq', disabled }, [ui.addListItem]);
      b.addEventListener('click', () => {
        const now = current();
        const value = now.bundle ? valueTemplateAt(now.bundle, ctx.guide(), [...ref.path, 0], now.data) : null;
        run({ op: 'push', at: ref, value });
      });
      groupsEl.append(b);
    }

    if (freeForm) el.insertBefore(keyRow, errorEl);
    else keyRow.remove();
    advancedToggle.disabled = disabled;
    keyInput.disabled = disabled;
    keyBtn.disabled = disabled;
    el.hidden = items.length === 0 && !freeForm;
  }

  handles.set(el, {
    update,
    destroy() {
      destroyed = true;
      el.remove();
    },
  });
  update();
  return el;
}
