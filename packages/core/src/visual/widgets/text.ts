import type { ScalarValue, YamlValue } from '../../document/types.js';
import { h } from '../../editor/dom.js';
import type { JsonSchema } from '../../formats/types.js';
import type { WidgetContext, WidgetFactory, WidgetInstance } from './types.js';

/** What typed text means: a value to commit, an error to show, or nothing (an empty box). */
type Parsed = { readonly value: ScalarValue } | { readonly error: string } | undefined;

interface Codec {
  parse(text: string): Parsed;
  /** The text that shows `v`. */
  format(v: YamlValue): string;
  /** `inputmode` hint for touch keyboards. */
  readonly inputMode?: string;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const INTEGER = /^[+-]?\d+$/;

const formatScalar = (v: YamlValue): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');

/** A single-line text input that commits on every keystroke. */
function textInput(ctx: WidgetContext, codec: Codec): WidgetInstance {
  const doc = document;
  const errorId = `${ctx.id}-error`;
  const input = h(doc, 'input', { type: 'text', id: ctx.id, class: 'sw-input', 'aria-describedby': errorId, autocomplete: 'off', spellcheck: 'false' });
  if (codec.inputMode) input.setAttribute('inputmode', codec.inputMode);
  const error = h(doc, 'span', { class: 'sw-field-error', id: errorId });
  const el = h(doc, 'div', { class: 'sw-widget sw-widget-text' }, [input, error]);
  let last: YamlValue = ctx.value;

  const setError = (message: string): void => {
    error.textContent = message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };
  const show = (v: YamlValue): void => {
    input.value = codec.format(v);
    setError('');
  };

  input.addEventListener('input', () => {
    const parsed = codec.parse(input.value);
    if (!parsed) return setError('');
    if ('error' in parsed) return setError(parsed.error);
    const refused = ctx.commit(parsed.value);
    setError(refused ? ctx.messages.editRefused : '');
  });

  show(ctx.value);
  input.disabled = ctx.readOnly;
  return {
    el,
    update(value, readOnly) {
      input.disabled = readOnly;
      const changed = value !== last && JSON.stringify(value) !== JSON.stringify(last);
      last = value;
      const parsed = codec.parse(input.value);
      if (parsed && 'value' in parsed && parsed.value === value) return; // already shows it, however it is spelled
      const focused = input.ownerDocument.activeElement === input;
      // The user's own (possibly invalid) text stays while they are in the box and the document did not change under them.
      if (changed || !focused) {
        if (input.value !== codec.format(value) || error.textContent) show(value);
      }
    },
    focus: () => input.focus(),
  };
}

/** Free text. */
export const stringWidget: WidgetFactory = (ctx) => textInput(ctx, { parse: (t) => ({ value: t }), format: formatScalar });

/** A number; typed text is parsed, so the document gets a number rather than a string. */
export const numberWidget: WidgetFactory = (ctx) =>
  textInput(ctx, {
    inputMode: 'decimal',
    format: formatScalar,
    parse(t) {
      const s = t.trim();
      if (s === '') return undefined;
      const n = Number(s);
      return NUMBER.test(s) && Number.isFinite(n) ? { value: n } : { error: ctx.messages.invalidNumber };
    },
  });

/** A whole number. */
export const integerWidget: WidgetFactory = (ctx) =>
  textInput(ctx, {
    inputMode: 'numeric',
    format: formatScalar,
    parse(t) {
      const s = t.trim();
      if (s === '') return undefined;
      const n = Number(s);
      return INTEGER.test(s) && Number.isSafeInteger(n) ? { value: n } : { error: ctx.messages.invalidInteger };
    },
  });

/** A number or a name, such as a port: digits are committed as a number, anything else as a string. */
export const intOrStringWidget: WidgetFactory = (ctx) =>
  textInput(ctx, {
    format: formatScalar,
    parse(t) {
      const s = t.trim();
      if (s === '') return undefined;
      const n = Number(s);
      return { value: INTEGER.test(s) && Number.isSafeInteger(n) ? n : s };
    },
  });

/** The pattern of the string branch of a quantity schema, if it compiles. */
function quantityPattern(schema: JsonSchema): RegExp | undefined {
  const alts = schema['anyOf'];
  if (!Array.isArray(alts)) return undefined;
  for (const a of alts) {
    const p = (a as JsonSchema | null)?.['pattern'];
    if (typeof p === 'string') {
      try {
        return new RegExp(p);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** A resource quantity such as `500m` or `1Gi`; a plain number stays a number. */
export const quantityWidget: WidgetFactory = (ctx) => {
  const pattern = quantityPattern(ctx.schema);
  return textInput(ctx, {
    format: formatScalar,
    parse(t) {
      const s = t.trim();
      if (s === '') return undefined;
      if (pattern && !pattern.test(s)) return { error: ctx.messages.invalidQuantity };
      const n = Number(s);
      return { value: PLAIN_NUMBER.test(s) && String(n) === s ? n : s };
    },
  });
};
