import type { EditorContext } from '../editor/context.js';
import { h } from '../editor/dom.js';
import type { UiMessages } from '../editor/messages.js';
import type { VariableDecl, VariableType } from '../formats/types.js';
import { NAME_PATTERN, checkDecl } from '../variables/decl.js';

/**
 * The Variables section of the visual pane.
 * @internal
 */
export interface VariablesSection {
  /** The section's root element. */
  readonly el: HTMLElement;
  /** Re-reads the declarations: reuses the cards by name, drops vanished ones, adds new ones. */
  update(): void;
  /** Focuses the first card's name input, or the add button when there are no cards. */
  focusFirst(): void;
  /** Releases the section. */
  destroy(): void;
}

const TYPES: readonly VariableType[] = ['string', 'number', 'boolean', 'port', 'enum'];

const typeLabel = (ui: UiMessages, t: VariableType): string =>
  ({
    string: ui.variableTypeString,
    number: ui.variableTypeNumber,
    boolean: ui.variableTypeBoolean,
    port: ui.variableTypePort,
    enum: ui.variableTypeEnum,
  })[t];

type DefaultKind = 'text' | 'boolean' | 'enum';

interface Card {
  /** The declaration's name, which keys the card; follows a rename. */
  key: string;
  decl: VariableDecl;
  /** The user picked `enum` but has not listed any values yet, so nothing can be written. */
  pendingEnum: boolean;
  /** What the default control was built for: its kind and, for `enum`, the values. */
  defaultSig: string;
  readonly el: HTMLElement;
  readonly legend: HTMLElement;
  readonly name: HTMLInputElement;
  readonly type: HTMLSelectElement;
  readonly typeField: HTMLElement;
  readonly defaultField: HTMLElement;
  readonly enumField: HTMLElement;
  readonly enumInput: HTMLInputElement;
  readonly description: HTMLInputElement;
  readonly remove: HTMLButtonElement;
  readonly error: HTMLElement;
}

/** The declaration without empty optional fields, in a stable order. */
function clean(d: VariableDecl): VariableDecl {
  return {
    name: d.name,
    type: d.type,
    ...(d.type === 'enum' && d.enumValues ? { enumValues: [...d.enumValues] } : {}),
    ...(d.default !== undefined ? { default: d.default } : {}),
    ...(d.description !== undefined && d.description !== '' ? { description: d.description } : {}),
  };
}

/** `d` without its default when the default does not fit the type any more. */
function fitted(d: VariableDecl): VariableDecl {
  if (checkDecl(d) !== 'badDefault') return d;
  const { default: _dropped, ...rest } = d;
  return rest;
}

let nextId = 0;

/**
 * Mounts the Variables section: one card per declaration, keyed by name and patched in place, so
 * focus stays in the control being edited. Every commit is one `set` or `remove` on the store (one
 * undo step). Controls are disabled while the editor is read-only or the text does not parse.
 * @internal
 */
export function mountVariablesSection(ctx: EditorContext, doc: Document): VariablesSection {
  const ui = ctx.messages.ui;
  const cards = new Map<string, Card>();
  const empty = h(doc, 'p', { class: 'sw-variables-empty' }, [ui.variablesEmpty]);
  const list = h(doc, 'div', { class: 'sw-variables-list' });
  const add = h(doc, 'button', { type: 'button', class: 'sw-btn sw-variables-add' }, [ui.addVariable]);
  const el = h(doc, 'div', { class: 'sw-variables' }, [empty, list, add]);

  const disabled = (): boolean => ctx.readOnly() || !ctx.store.parsed.ok;
  const names = (): string[] => ctx.variables()?.get().map((d) => d.name) ?? [];

  const field = (cls: string, label: string, control: HTMLElement): HTMLElement =>
    h(doc, 'label', { class: `sw-variable-field sw-variable-field-${cls}` }, [h(doc, 'span', { class: 'sw-variable-label' }, [label]), control]);

  /** Marks `control` invalid with `message` (or clears every mark when `control` is undefined). */
  function showError(card: Card, control: HTMLElement | undefined, message: string): void {
    for (const c of card.el.querySelectorAll('[aria-invalid]')) {
      c.removeAttribute('aria-invalid');
      c.removeAttribute('aria-describedby');
    }
    card.error.textContent = control ? message : '';
    control?.setAttribute('aria-invalid', 'true');
    control?.setAttribute('aria-describedby', card.error.id);
  }

  /**
   * Writes `next` over the card's declaration. When the store refuses, retyping cannot help, so the
   * controls go back to the stored declaration (in place, keeping focus) and `control` shows `editRefused`.
   */
  function commit(card: Card, next: VariableDecl, control: HTMLElement, replaces = card.key): boolean {
    const d = clean(next);
    if (JSON.stringify(d) === JSON.stringify(clean(card.decl)) && !card.pendingEnum) {
      showError(card, undefined, '');
      return true;
    }
    if (!ctx.variables()?.set(d, replaces)) {
      showError(card, undefined, ''); // unmarked, so patch resets every control
      patch(card, card.decl);
      showError(card, control, ui.editRefused);
      return false;
    }
    showError(card, undefined, '');
    return true;
  }

  function onName(card: Card): void {
    const value = card.name.value.trim();
    if (value === card.key) {
      card.name.value = value;
      showError(card, undefined, '');
      return;
    }
    if (!NAME_PATTERN.test(value)) {
      showError(card, card.name, ui.variableNameInvalid);
      return;
    }
    if (names().includes(value)) {
      showError(card, card.name, ui.variableNameTaken.replace('{name}', value));
      return;
    }
    // The card moves to its new key first, so the update the store fires patches this card (and its focus) in place.
    const old = card.key;
    cards.delete(old);
    card.key = value;
    cards.set(value, card);
    card.el.dataset['swName'] = value;
    if (!commit(card, { ...card.decl, name: value }, card.name, old)) {
      cards.delete(value);
      card.key = old;
      cards.set(old, card);
      card.el.dataset['swName'] = old;
    }
  }

  function onType(card: Card): void {
    const type = card.type.value as VariableType;
    if (type === 'enum' && !card.decl.enumValues?.length) {
      card.pendingEnum = true;
      patch(card, card.decl);
      return;
    }
    card.pendingEnum = false;
    const { enumValues, ...rest } = card.decl;
    const next = fitted(type === 'enum' ? { ...rest, type, enumValues } : { ...rest, type });
    if (commit(card, next, card.type) && card.type.value !== card.decl.type) patch(card, card.decl);
  }

  function onEnum(card: Card): void {
    const values = card.enumInput.value.split(',').map((v) => v.trim()).filter((v) => v !== '');
    if (values.length === 0) {
      showError(card, card.enumInput, ui.variableEnumValuesRequired);
      return;
    }
    const { default: _d, ...rest } = card.decl;
    const withDefault = card.decl.default !== undefined ? { ...rest, default: card.decl.default } : rest;
    const typed = card.enumInput.value;
    if (commit(card, fitted({ ...withDefault, type: 'enum', enumValues: values }), card.enumInput)) card.pendingEnum = false;
    // A refused list stays as typed, like a rejected value (the stored one may be empty while the enum is pending).
    else card.enumInput.value = typed;
  }

  function onDefault(card: Card, control: HTMLInputElement | HTMLSelectElement): void {
    const text = control.value;
    const { default: _d, ...rest } = card.decl;
    let value: string | number | boolean | undefined;
    if (text === '') value = undefined;
    else if (card.decl.type === 'boolean') value = text === 'true';
    else if (card.decl.type === 'number' || card.decl.type === 'port') {
      const n = text.trim() === '' ? Number.NaN : Number(text);
      if (!Number.isFinite(n)) {
        showError(card, control, ui.invalidNumber);
        return;
      }
      if (card.decl.type === 'port' && !(Number.isInteger(n) && n >= 1 && n <= 65535)) {
        showError(card, control, ui.invalidInteger);
        return;
      }
      value = n;
    } else value = text;
    commit(card, value === undefined ? rest as VariableDecl : { ...rest, default: value } as VariableDecl, control);
  }

  function onRemove(card: Card): void {
    const all = names();
    const next = all[all.indexOf(card.key) + 1];
    if (!ctx.variables()?.remove(card.key)) {
      showError(card, card.remove, ui.editRefused);
      return;
    }
    const target = next === undefined ? undefined : cards.get(next)?.name;
    (target ?? add).focus();
  }

  function createCard(decl: VariableDecl): Card {
    const id = nextId++;
    const legend = h(doc, 'legend', { class: 'sw-variable-legend' });
    const name = h(doc, 'input', { type: 'text', class: 'sw-input sw-variable-name', spellcheck: 'false', autocomplete: 'off' });
    const type = h(doc, 'select', { class: 'sw-input sw-variable-type' }, TYPES.map((t) => h(doc, 'option', { value: t }, [typeLabel(ui, t)])));
    const enumInput = h(doc, 'input', { type: 'text', class: 'sw-input sw-variable-enum', autocomplete: 'off' });
    const description = h(doc, 'input', { type: 'text', class: 'sw-input sw-variable-description', autocomplete: 'off' });
    const remove = h(doc, 'button', { type: 'button', class: 'sw-btn sw-variable-remove' });
    const error = h(doc, 'p', { class: 'sw-field-error sw-variable-error', id: `sw-variable-error-${id}`, role: 'alert' });
    const typeField = field('type', ui.variableType, type);
    const defaultField = field('default', ui.variableDefault, h(doc, 'input'));
    const enumField = field('enum', ui.variableEnumValues, enumInput);
    const fieldset = h(doc, 'fieldset', { class: 'sw-variable', 'data-sw-name': decl.name }, [
      legend,
      field('name', ui.variableName, name),
      typeField,
      defaultField,
      field('description', ui.variableDescription, description),
      remove,
      error,
    ]);
    const card: Card = { key: decl.name, decl, pendingEnum: false, defaultSig: '', el: fieldset, legend, name, type, typeField, defaultField, enumField, enumInput, description, remove, error };
    name.addEventListener('change', () => onName(card));
    type.addEventListener('change', () => onType(card));
    enumInput.addEventListener('change', () => onEnum(card));
    description.addEventListener('change', () => {
      const text = description.value;
      commit(card, { ...card.decl, description: text }, description);
    });
    remove.addEventListener('click', () => onRemove(card));
    return card;
  }

  /** Brings the card in line with `decl` without replacing controls that did not change. */
  function patch(card: Card, decl: VariableDecl): void {
    card.decl = decl;
    if (card.pendingEnum && decl.type === 'enum') card.pendingEnum = false;
    const effective: VariableType = card.pendingEnum ? 'enum' : decl.type;
    const off = disabled();
    // A control that shows a rejected value keeps it until the user edits it again.
    const setValue = (c: HTMLInputElement | HTMLSelectElement, v: string): void => {
      if (c.value !== v && c.getAttribute('aria-invalid') !== 'true') c.value = v;
    };
    card.legend.textContent = decl.name;
    card.el.dataset['swName'] = decl.name;
    setValue(card.name, decl.name);
    setValue(card.type, effective);
    setValue(card.description, decl.description ?? '');
    card.remove.textContent = ui.removeVariable.replace('{name}', decl.name);

    if (effective === 'enum') {
      if (!card.enumField.isConnected) card.typeField.after(card.enumField);
      setValue(card.enumInput, (decl.enumValues ?? []).join(', '));
    } else card.enumField.remove();

    const kind: DefaultKind = effective === 'boolean' ? 'boolean' : effective === 'enum' ? 'enum' : 'text';
    const values = effective === 'enum' ? (decl.enumValues ?? []) : [];
    const sig = `${kind}:${values.join('\u0000')}`;
    let control = card.defaultField.querySelector<HTMLInputElement | HTMLSelectElement>(':scope > .sw-variable-default');
    if (!control || card.defaultSig !== sig) {
      card.defaultSig = sig;
      const options = kind === 'boolean' ? ['true', 'false'] : values;
      control =
        kind === 'text'
          ? h(doc, 'input', { type: 'text', class: 'sw-input sw-variable-default', autocomplete: 'off', inputmode: effective === 'string' ? undefined : 'decimal' })
          : h(doc, 'select', { class: 'sw-input sw-variable-default' }, [
              h(doc, 'option', { value: '' }, ['']),
              ...options.map((v) => h(doc, 'option', { value: v }, [v])),
            ]);
      const made = control;
      made.addEventListener('change', () => onDefault(card, made));
      card.defaultField.replaceChildren(card.defaultField.firstElementChild!, made);
    }
    setValue(control, decl.default === undefined ? '' : String(decl.default));
    for (const c of [card.name, card.type, card.enumInput, card.description, card.remove, control]) c.disabled = off;
  }

  function update(): void {
    const decls = ctx.variables()?.get() ?? [];
    const keep = new Set(decls.map((d) => d.name));
    let lostFocus = false;
    for (const [key, card] of cards) {
      if (keep.has(key)) continue;
      if (card.el.contains(doc.activeElement)) lostFocus = true;
      card.el.remove();
      cards.delete(key);
    }
    decls.forEach((d, i) => {
      let card = cards.get(d.name);
      if (!card) {
        card = createCard(d);
        cards.set(d.name, card);
      }
      patch(card, d);
      // Only a card that is out of place moves: moving the focused one would drop its focus.
      if (list.children[i] !== card.el) list.insertBefore(card.el, list.children[i] ?? null);
    });
    empty.hidden = decls.length > 0;
    add.disabled = disabled();
    if (lostFocus && !add.disabled) add.focus();
  }

  add.addEventListener('click', () => {
    const taken = new Set(names());
    let n = 1;
    while (taken.has(`VAR_${n}`)) n++;
    const name = `VAR_${n}`;
    if (ctx.variables()?.set({ name, type: 'string' })) cards.get(name)?.name.focus();
  });

  const off = ctx.onVariables(() => update());
  update();

  return {
    el,
    update,
    focusFirst() {
      const first = cards.values().next().value as Card | undefined;
      (first?.name ?? add).focus();
    },
    destroy() {
      off();
      el.remove();
    },
  };
}
