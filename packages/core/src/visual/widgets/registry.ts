import type { ResolvedSchema } from '../../engine/resolve.js';
import type { GuideField, JsonSchema } from '../../formats/types.js';
import { booleanWidget, enumWidget } from './choice.js';
import { keyValueWidget, stringListWidget } from './collections.js';
import { refKeyWidget, refWidget } from './reference.js';
import { secretDataWidget } from './secret.js';
import { integerWidget, intOrStringWidget, numberWidget, quantityWidget, stringWidget, suggestWidget } from './text.js';
import type { WidgetDefinition, WidgetFactory, WidgetRef, WidgetRegistry } from './types.js';

const plain = (create: WidgetFactory): WidgetDefinition => ({ create });

/** The built-in widgets, by name. A host's `widgets` option is merged over these. */
export const defaultWidgets: WidgetRegistry = {
  string: plain(stringWidget),
  number: plain(numberWidget),
  integer: plain(integerWidget),
  boolean: plain(booleanWidget),
  enum: plain(enumWidget),
  'int-or-string': plain(intOrStringWidget),
  quantity: plain(quantityWidget),
  'string-list': plain(stringListWidget),
  'key-value': plain(keyValueWidget),
  suggest: plain(suggestWidget),
  ref: plain(refWidget),
  'ref-key': plain(refKeyWidget),
  'secret-data': { create: secretDataWidget, managesKeys: true },
};

const isObj = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (registry: WidgetRegistry, name: string): boolean => Object.prototype.hasOwnProperty.call(registry, name);

/** The single type of `s`, ignoring `null`; `[T, 'string']` with T a boolean or number type is T (the string is a placeholder such as `${NAME}`). */
function baseType(s: JsonSchema): string | undefined {
  const t = s['type'];
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const rest = t.filter((x): x is string => typeof x === 'string' && x !== 'null');
    if (rest.length === 2 && rest.includes('string')) {
      const other = rest.find((x) => x !== 'string');
      return other === 'boolean' || other === 'integer' || other === 'number' ? other : undefined;
    }
    return rest.length === 1 ? rest[0] : undefined;
  }
  return undefined;
}

/** The name of the built-in widget that fits the shape of `s`, or `undefined` for a nested part. */
function byShape(s: JsonSchema): string | undefined {
  const any = s['anyOf'];
  if (Array.isArray(any) && any.length === 2 && any.every(isObj)) {
    const alts = any as JsonSchema[];
    const str = alts.find((a) => baseType(a) === 'string');
    const other = alts.find((a) => a !== str);
    if (str && other && typeof str['pattern'] === 'string' && baseType(other) === 'number') return 'quantity';
    if (str && other && baseType(other) === 'integer') return 'int-or-string';
  }
  const values = s['enum'];
  if (Array.isArray(values) && values.length > 0 && values.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) return 'enum';
  const type = baseType(s);
  if (type === 'boolean' || type === 'integer' || type === 'number' || type === 'string') return type;
  if (type === 'object') {
    const props = s['properties'];
    const ap = s['additionalProperties'];
    const noProps = !isObj(props) || Object.keys(props).length === 0;
    return noProps && isObj(ap) && baseType(ap) === 'string' ? 'key-value' : undefined;
  }
  if (type === 'array') {
    const items = s['items'];
    return isObj(items) && baseType(items) === 'string' ? 'string-list' : undefined;
  }
  return undefined;
}

/**
 * Chooses the widget for a field, in this order:
 * 1. the guide's `widget` ({@link WidgetRef}), when the registry has its `name`;
 * 2. `suggest` (a text input with a `<datalist>`, so free text is still accepted) for a string field
 *    whose guide entry has non-empty `options` and whose schema has no `enum`;
 * 3. the schema shape (quantity, int-or-string, enum, boolean, integer, number, string, key-value,
 *    string-list). A list of strings keeps `string-list`, which offers the `options` itself. A type
 *    list that pairs `boolean`, `integer` or `number` with `'string'` (and optionally `'null'`) is
 *    shaped as that type: the string is the field's variable placeholder, and the row shows it as
 *    a variable, not in the typed widget.
 *
 * An unknown guide name falls through and never throws.
 * @param r - The field's resolved schema.
 * @param field - The field's guide entry, if any.
 * @param registry - The widgets available.
 * @returns The widget name and parameter, or `undefined` when the field is a nested part.
 */
export function pickWidget(r: ResolvedSchema, field: GuideField | undefined, registry: WidgetRegistry): WidgetRef | undefined {
  const wanted = field?.widget;
  if (wanted && has(registry, wanted.name)) return wanted.param === undefined || wanted.param === '' ? { name: wanted.name } : { name: wanted.name, param: wanted.param };
  if (field?.options && field.options.length > 0 && baseType(r.schema) === 'string' && r.schema['enum'] === undefined && has(registry, 'suggest')) return { name: 'suggest' };
  const shaped = byShape(r.schema);
  return shaped !== undefined && has(registry, shaped) ? { name: shaped } : undefined;
}
