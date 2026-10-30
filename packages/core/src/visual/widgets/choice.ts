import type { ScalarValue, YamlValue } from '../../document/types.js';
import { h } from '../../editor/dom.js';
import type { WidgetFactory } from './types.js';

/** A choice from the schema's `enum`; a value outside the list stays visible and selected. */
export const enumWidget: WidgetFactory = (ctx) => {
  const doc = document;
  const errorId = `${ctx.id}-error`;
  const select = h(doc, 'select', { id: ctx.id, class: 'sw-input', 'aria-describedby': errorId });
  const error = h(doc, 'span', { class: 'sw-field-error', id: errorId });
  const el = h(doc, 'div', { class: 'sw-widget sw-widget-enum' }, [select, error]);
  const listed = (Array.isArray(ctx.schema['enum']) ? (ctx.schema['enum'] as unknown[]) : []).filter(
    (v): v is ScalarValue => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
  let options: ScalarValue[] = [];
  let signature = '';

  let last: YamlValue = ctx.value;
  const show = (value: YamlValue): void => {
    last = value;
    const scalar: ScalarValue | undefined = value === null || ['string', 'number', 'boolean'].includes(typeof value) ? (value as ScalarValue) : undefined;
    const next: ScalarValue[] = [...listed];
    const missing = scalar !== undefined && !next.some((v) => Object.is(v, scalar)) ? scalar : undefined;
    if (missing !== undefined) next.push(missing);
    const sig = JSON.stringify(next);
    if (sig !== signature) {
      signature = sig;
      options = next;
      select.replaceChildren(...next.map((v) => h(doc, 'option', { value: v === null ? '' : String(v) }, [v === null ? '' : String(v)])));
    }
    select.value = scalar === undefined || scalar === null ? '' : String(scalar);
  };

  select.addEventListener('change', () => {
    const picked = options.find((v) => (v === null ? '' : String(v)) === select.value);
    if (picked === undefined) return;
    const refused = ctx.commit(picked);
    error.textContent = refused ? ctx.messages.editRefused : '';
    if (refused) show(last);
  });

  show(ctx.value);
  select.disabled = ctx.readOnly;
  return {
    el,
    update(value, readOnly) {
      select.disabled = readOnly;
      show(value);
    },
    focus: () => select.focus(),
  };
};

/** A checkbox. */
export const booleanWidget: WidgetFactory = (ctx) => {
  const doc = document;
  const errorId = `${ctx.id}-error`;
  const box = h(doc, 'input', { type: 'checkbox', id: ctx.id, class: 'sw-input sw-checkbox', 'aria-describedby': errorId });
  const error = h(doc, 'span', { class: 'sw-field-error', id: errorId });
  const el = h(doc, 'div', { class: 'sw-widget sw-widget-boolean' }, [box, error]);
  box.checked = ctx.value === true;
  box.disabled = ctx.readOnly;
  box.addEventListener('change', () => {
    const refused = ctx.commit(box.checked);
    error.textContent = refused ? ctx.messages.editRefused : '';
    if (refused) box.checked = !box.checked;
  });
  return {
    el,
    update(value, readOnly) {
      box.disabled = readOnly;
      box.checked = value === true;
    },
    focus: () => box.focus(),
  };
};
