import type { JsonSchema, VariableDecl } from '../formats/types.js';

type FieldType = 'string' | 'number' | 'integer' | 'boolean';

const SCALARS: readonly string[] = ['string', 'number', 'integer', 'boolean'];
/** The types a `[T, 'string']` list stands for (compose interpolation; the widget registry's `baseType` reads it the same way). */
const INTERPOLATED: readonly string[] = ['boolean', 'integer', 'number'];
const isObj = (v: unknown): v is JsonSchema => v !== null && typeof v === 'object' && !Array.isArray(v);

function collect(schema: JsonSchema, into: Set<FieldType>): void {
  const t = schema['type'];
  if (typeof t === 'string') {
    if (SCALARS.includes(t)) into.add(t as FieldType);
  } else if (Array.isArray(t)) {
    // A list like ['integer', 'string'] is how a field takes a number or its placeholder text:
    // the other type is the real one. Only that pair (one boolean, integer or number type next to
    // 'string', 'null' aside) drops 'string'; a list such as an environment value's
    // ['string', 'number', 'boolean', 'null'] takes strings too (R20).
    let kept = t.filter((x): x is string => typeof x === 'string' && x !== 'null');
    if (kept.length === 2 && kept.includes('string') && kept.some((x) => INTERPOLATED.includes(x))) kept = kept.filter((x) => x !== 'string');
    for (const x of kept) if (SCALARS.includes(x)) into.add(x as FieldType);
  } else if (Array.isArray(schema['enum'])) {
    for (const v of schema['enum']) {
      if (typeof v === 'string') into.add('string');
      else if (typeof v === 'boolean') into.add('boolean');
      else if (typeof v === 'number') into.add(Number.isInteger(v) ? 'integer' : 'number');
    }
  }
  for (const key of ['anyOf', 'oneOf']) {
    const branches = schema[key];
    if (Array.isArray(branches)) for (const b of branches) if (isObj(b)) collect(b, into);
  }
}

/**
 * The scalar types a field accepts: its `type` (a string or a list), the branches of `anyOf` /
 * `oneOf`, or, when it has no `type`, the value types of its `enum`. In a type list that is exactly
 * one of `boolean`, `integer` or `number` plus `'string'` (and optionally `'null'`), the `'string'`
 * is dropped: `[T, 'string']` gives `{T}`. Any other list keeps it. Non-scalar types are left out,
 * so an empty set means "no scalar constraint".
 */
export function fieldTypes(schema: JsonSchema): ReadonlySet<FieldType> {
  const out = new Set<FieldType>();
  collect(schema, out);
  return out;
}

/**
 * Whether a variable of this type can stand for a whole field value of the given schema.
 * `string` fits string fields, `number` fits number or integer, `port` fits integer, number or
 * string, `boolean` fits boolean, and `enum` fits string fields (every member must be allowed by
 * the field's own `enum`, if it has one). A field with no scalar type accepts anything.
 */
export function fitsField(decl: VariableDecl, schema: JsonSchema): boolean {
  const types = fieldTypes(schema);
  if (types.size === 0) return true;
  switch (decl.type) {
    case 'string':
      return types.has('string');
    case 'number':
      return types.has('number') || types.has('integer');
    case 'port':
      return types.has('integer') || types.has('number') || types.has('string');
    case 'boolean':
      return types.has('boolean');
    default: {
      if (!types.has('string')) return false;
      const allowed = schema['enum'];
      return !Array.isArray(allowed) || (decl.type === 'enum' ? decl.enumValues : []).every((v) => allowed.includes(v));
    }
  }
}

/**
 * The variable type a new variable for this field should have: string for a type list that keeps
 * `'string'` next to other types (such as an environment value), else boolean, number (for integer
 * or number), else string.
 */
export function inferVariableType(schema: JsonSchema): 'string' | 'number' | 'boolean' {
  const types = fieldTypes(schema);
  if (Array.isArray(schema['type']) && types.has('string') && types.size > 1) return 'string';
  if (types.has('boolean')) return 'boolean';
  if (types.has('integer') || types.has('number')) return 'number';
  return 'string';
}
