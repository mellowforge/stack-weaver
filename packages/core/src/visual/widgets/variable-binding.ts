import type { NodeRef, YamlValue } from '../../document/types.js';
import type { EditorContext } from '../../editor/context.js';
import { h } from '../../editor/dom.js';
import type { JsonSchema, VariableDecl } from '../../formats/types.js';
import { fitsField } from '../../variables/fit.js';
import type { WidgetInstance } from './types.js';
import { formatMessage } from '../../editor/format-message.js';

/**
 * The widget of a field in variable mode: a select of the variables that fit the field, or a note
 * when none does. Choosing a variable writes its bare placeholder (`${NAME}`, never a default) as
 * one undo step. A current reference that is undeclared or does not fit stays listed, and selected.
 * @param o.id - The DOM id of the select, so the row's label names it.
 * @param o.label - The field's display label.
 * @param o.ref - The node the choice is written to.
 * @param o.schema - The field's schema, which decides which variables fit.
 * @param o.value - The value when mounted; `update` delivers later ones.
 * @param o.readOnly - Whether the select starts disabled; `update` delivers later changes.
 * @internal
 */
export function mountVariableBinding(
  ctx: EditorContext,
  o: { id: string; label: string; ref: NodeRef; schema: JsonSchema; value: YamlValue; readOnly: boolean },
): WidgetInstance {
  const doc = document;
  const ui = ctx.messages.ui;
  const root = h(doc, 'div', { class: 'sw-widget sw-variable-binding' });
  const error = h(doc, 'span', { class: 'sw-field-error' });
  let value = o.value;
  let readOnly = o.readOnly;
  let select: HTMLSelectElement | undefined;
  let sig = '';

  const current = (): string | undefined => (typeof value === 'string' ? ctx.format()?.variables?.referenceOf(value) : undefined);

  const choose = (name: string): void => {
    const reference = ctx.format()?.variables?.reference(name);
    if (name === '' || reference === undefined || readOnly || name === current()) return;
    const r = ctx.store.edit({ op: 'set', at: o.ref, value: reference });
    error.textContent = r.ok ? '' : ui.editRefused;
    // A refused choice leaves the document as it was: the select goes back to it.
    if (!r.ok) render();
  };

  function render(): void {
    const decls = ctx.variables()?.get() ?? [];
    const name = current();
    const fitting = decls.filter((d: VariableDecl) => fitsField(d, o.schema)).map((d) => d.name);
    const listed = name !== undefined && !fitting.includes(name) ? name : undefined;
    const names = [...fitting].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const next = JSON.stringify([names, listed]);

    if (names.length === 0 && listed === undefined) {
      if (select || sig === '') {
        select = undefined;
        root.replaceChildren(h(doc, 'p', { class: 'sw-variable-none' }, [ui.variableNone]), error);
      }
      sig = next;
      return;
    }
    if (!select) {
      select = h(doc, 'select', { id: o.id, class: 'sw-input', 'aria-label': formatMessage(ui.variableSelect, { label: o.label }) });
      select.addEventListener('change', () => choose(select!.value));
      root.replaceChildren(select, error);
      sig = '';
    }
    if (sig !== next) {
      sig = next;
      select.replaceChildren(
        h(doc, 'option', { value: '' }),
        ...names.map((n) => h(doc, 'option', { value: n }, [n])),
        ...(listed !== undefined ? [h(doc, 'option', { value: listed }, [formatMessage(ui.variableUndeclared, { name: listed })])] : []),
      );
    }
    select.value = name ?? '';
    select.disabled = readOnly;
  }

  render();
  const unsubscribe = ctx.onVariables(() => render());

  return {
    el: root,
    update(v, ro) {
      value = v;
      readOnly = ro;
      render();
    },
    focus: () => select?.focus(),
    destroy: unsubscribe,
  };
}
