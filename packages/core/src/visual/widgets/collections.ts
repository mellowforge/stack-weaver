import type { EditResult } from '../../document/edit.js';
import type { YamlValue } from '../../document/types.js';
import { h } from '../../editor/dom.js';
import type { WidgetContext, WidgetFactory } from './types.js';

const isScalar = (v: unknown): v is string | number | boolean | null => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const textOf = (v: unknown): string => (v === null || v === undefined || !isScalar(v) ? '' : String(v));
const fill = (template: string, label: string): string => template.replace('{label}', label);

/**
 * Shared frame of the list widgets: the group, an error line and the add row.
 * @internal
 */
export function frame(ctx: WidgetContext, kind: string) {
  const doc = document;
  const errorId = `${ctx.id}-error`;
  const items = h(doc, 'div', { class: 'sw-list-items' });
  const error = h(doc, 'span', { class: 'sw-field-error', id: errorId });
  const adder = h(doc, 'div', { class: 'sw-list-add' });
  const el = h(doc, 'div', { class: `sw-widget sw-list sw-widget-${kind}`, id: ctx.id, role: 'group', 'aria-labelledby': `${ctx.id}-label`, 'aria-describedby': errorId }, [
    items,
    adder,
    error,
  ]);
  const fail = (r: EditResult, duplicate?: string): boolean => {
    error.textContent = r.ok ? '' : r.reason === 'duplicate-key' && duplicate ? duplicate : ctx.messages.editRefused;
    return r.ok;
  };
  return { doc, el, items, adder, error, fail };
}

/**
 * A reusable item row's remove button.
 * @internal
 */
export function removeButton(ctx: WidgetContext, name: string, onClick: () => void): HTMLButtonElement {
  const b = h(document, 'button', { type: 'button', class: 'sw-btn sw-list-remove', 'aria-label': fill(ctx.messages.removeField, name) }, ['×']);
  b.addEventListener('click', onClick);
  return b;
}

interface ListItem {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly remove: HTMLButtonElement;
}

/** A list of strings: one input per item, with remove buttons and an add row. Items get the guide's `options` as suggestions. */
export const stringListWidget: WidgetFactory = (ctx) => {
  const ui = ctx.messages;
  const f = frame(ctx, 'string-list');
  const rows: ListItem[] = [];

  const input = h(f.doc, 'input', { type: 'text', class: 'sw-input', 'aria-label': `${ctx.label} ${ui.newItem}`, autocomplete: 'off' });
  const addBtn = h(f.doc, 'button', { type: 'button', class: 'sw-btn sw-list-add-btn', 'aria-label': `${ui.addItem} ${ctx.label}` }, [ui.addItem]);
  f.adder.append(input, addBtn);
  // The guide's suggested values, offered on every input; any other text is still accepted.
  const suggestions = ctx.options ?? [];
  const listId = `${ctx.id}-list`;
  if (suggestions.length > 0) {
    f.el.append(h(f.doc, 'datalist', { id: listId }, suggestions.map((v) => h(f.doc, 'option', { value: v }))));
    input.setAttribute('list', listId);
  }
  const add = (): void => {
    if (input.value === '') return;
    if (f.fail(ctx.edit({ op: 'push', at: ctx.ref, value: input.value }))) input.value = '';
  };
  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  const makeItem = (i: number): ListItem => {
    const field = h(f.doc, 'input', { type: 'text', class: 'sw-input', autocomplete: 'off', list: suggestions.length > 0 ? listId : undefined });
    const at = (): { doc: number; path: (string | number)[] } => ({ doc: ctx.ref.doc, path: [...ctx.ref.path, i] });
    field.addEventListener('input', () => {
      f.fail(ctx.edit({ op: 'set', at: at(), value: field.value }));
    });
    const remove = removeButton(ctx, `${ctx.label} ${i + 1}`, () => {
      f.fail(ctx.edit({ op: 'delete', at: at() }));
    });
    return { el: h(f.doc, 'div', { class: 'sw-list-item' }, [field, remove]), input: field, remove };
  };

  let readOnlyNow = ctx.readOnly;
  const sync = (value: YamlValue): void => {
    const list = Array.isArray(value) ? (value as readonly YamlValue[]) : [];
    while (rows.length > list.length) rows.pop()!.el.remove();
    while (rows.length < list.length) {
      const item = makeItem(rows.length);
      rows.push(item);
      f.items.append(item.el);
    }
    list.forEach((v, i) => {
      const row = rows[i]!;
      const text = textOf(v);
      if (row.input.value !== text) row.input.value = text;
      row.input.setAttribute('aria-label', `${ctx.label} ${i + 1}`);
      row.input.disabled = readOnlyNow || !isScalar(v);
      row.remove.disabled = readOnlyNow;
    });
    input.disabled = readOnlyNow;
    addBtn.disabled = readOnlyNow;
  };
  sync(ctx.value);
  return {
    el: f.el,
    update(value, readOnly) {
      readOnlyNow = readOnly;
      sync(value);
    },
    focus: () => (rows[0]?.input ?? input).focus(),
  };
};

interface PairRow {
  readonly el: HTMLElement;
  readonly key: HTMLInputElement;
  readonly value: HTMLInputElement;
  readonly remove: HTMLButtonElement;
}

/** A map of strings: a key and a value per entry, with remove buttons and an add row. */
export const keyValueWidget: WidgetFactory = (ctx) => {
  const ui = ctx.messages;
  const f = frame(ctx, 'key-value');
  const rows = new Map<string, PairRow>();
  let current: Readonly<Record<string, YamlValue>> = {};
  let readOnlyNow = ctx.readOnly;
  const at = (key: string): { doc: number; path: (string | number)[] } => ({ doc: ctx.ref.doc, path: [...ctx.ref.path, key] });

  const keyInput = h(f.doc, 'input', { type: 'text', class: 'sw-input sw-kv-key', 'aria-label': `${ctx.label}, ${ui.entryKey}`, autocomplete: 'off' });
  const valueInput = h(f.doc, 'input', { type: 'text', class: 'sw-input sw-kv-value', 'aria-label': `${ctx.label}, ${ui.entryValue}`, autocomplete: 'off' });
  const addBtn = h(f.doc, 'button', { type: 'button', class: 'sw-btn sw-list-add-btn', 'aria-label': `${ui.addEntry} ${ctx.label}` }, [ui.addEntry]);
  f.adder.append(keyInput, valueInput, addBtn);
  const add = (): void => {
    const key = keyInput.value.trim();
    if (key === '') return;
    if (f.fail(ctx.edit({ op: 'add', at: ctx.ref, key, value: valueInput.value }), ui.keyExists)) {
      keyInput.value = '';
      valueInput.value = '';
    }
  };
  addBtn.addEventListener('click', add);
  for (const i of [keyInput, valueInput]) {
    i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
  }

  const makeRow = (name: string): PairRow => {
    const key = h(f.doc, 'input', { type: 'text', class: 'sw-input sw-kv-key', autocomplete: 'off' });
    const value = h(f.doc, 'input', { type: 'text', class: 'sw-input sw-kv-value', autocomplete: 'off' });
    value.addEventListener('input', () => {
      f.fail(ctx.edit({ op: 'set', at: at(name), value: value.value }));
    });
    // One `renameKey` splice: the pair keeps its place and comments, and it is one undo step.
    key.addEventListener('change', () => {
      const next = key.value.trim();
      if (next === '' || next === name) {
        key.value = name;
        return;
      }
      if (!f.fail(ctx.edit({ op: 'renameKey', at: at(name), key: next }), ui.keyExists)) key.value = name;
    });
    const remove = removeButton(ctx, `${ctx.label} ${name}`, () => {
      f.fail(ctx.edit({ op: 'delete', at: at(name) }));
    });
    return { el: h(f.doc, 'div', { class: 'sw-list-item' }, [key, value, remove]), key, value, remove };
  };

  const sync = (value: YamlValue): void => {
    current = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, YamlValue>>) : {};
    const names = Object.keys(current);
    for (const [name, row] of [...rows]) {
      if (!names.includes(name)) {
        row.el.remove();
        rows.delete(name);
      }
    }
    names.forEach((name, i) => {
      let row = rows.get(name);
      if (!row) {
        row = makeRow(name);
        rows.set(name, row);
      }
      if (f.items.children[i] !== row.el) f.items.insertBefore(row.el, f.items.children[i] ?? null);
      const v = current[name];
      if (row.key.value !== name) row.key.value = name;
      const text = textOf(v);
      if (row.value.value !== text) row.value.value = text;
      row.key.setAttribute('aria-label', `${ctx.label}, ${name}, ${ui.entryKey}`);
      row.value.setAttribute('aria-label', `${ctx.label}, ${name}, ${ui.entryValue}`);
      row.key.disabled = readOnlyNow;
      row.value.disabled = readOnlyNow || !isScalar(v);
      row.remove.disabled = readOnlyNow;
    });
    keyInput.disabled = valueInput.disabled = addBtn.disabled = readOnlyNow;
  };
  sync(ctx.value);
  return {
    el: f.el,
    update(value, readOnly) {
      readOnlyNow = readOnly;
      sync(value);
    },
    focus: () => keyInput.focus(),
  };
};
