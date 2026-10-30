import type { ResolvedSchema } from '../../engine/resolve.js';
import type { GuideField, JsonSchema } from '../../formats/types.js';
import { booleanWidget, enumWidget } from './choice.js';
import { keyValueWidget, stringListWidget } from './collections.js';
import { integerWidget, intOrStringWidget, numberWidget, quantityWidget, stringWidget } from './text.js';
import type { WidgetRegistry } from './types.js';

/** The built-in widgets, by name. A host's `widgets` option is merged over these. */
export const defaultWidgets: WidgetRegistry = {
  string: stringWidget,
  number: numberWidget,
  integer: integerWidget,
  boolean: booleanWidget,
  enum: enumWidget,
  'int-or-string': intOrStringWidget,
  quantity: quantityWidget,
  'string-list': stringListWidget,
  'key-value': keyValueWidget,
};

const isObj = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (registry: WidgetRegistry, name: string): boolean => Object.prototype.hasOwnProperty.call(registry, name);

/** The single type of `s`, ignoring `null`. */
function baseType(s: JsonSchema): string | undefined {
  const t = s['type'];
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const rest = t.filter((x): x is string => typeof x === 'string' && x !== 'null');
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
 * Chooses the widget for a field: the guide's `widget` (`name` or `name:param`) when the registry
 * has `name`, otherwise one by schema shape (quantity, int-or-string, enum, boolean, integer,
 * number, string, key-value, string-list). An unknown guide name falls through to the shape and
 * never throws.
 * @param r - The field's resolved schema.
 * @param field - The field's guide entry, if any.
 * @param registry - The widgets available.
 * @returns The widget name and parameter, or `undefined` when the field is a nested part.
 */
export function pickWidget(r: ResolvedSchema, field: GuideField | undefined, registry: WidgetRegistry): { name: string; param?: string } | undefined {
  const wanted = field?.widget;
  if (wanted) {
    const colon = wanted.indexOf(':');
    const name = colon < 0 ? wanted : wanted.slice(0, colon);
    const param = colon < 0 ? '' : wanted.slice(colon + 1);
    if (name !== '' && has(registry, name)) return param === '' ? { name } : { name, param };
  }
  const shaped = byShape(r.schema);
  return shaped !== undefined && has(registry, shaped) ? { name: shaped } : undefined;
}
