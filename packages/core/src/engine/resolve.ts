import type { YamlPath } from '../document/types.js';
import type { JsonSchema, SchemaBundle } from '../formats/types.js';

/** The schema found at a YAML path, with `$ref`s followed and `allOf` members merged. */
export interface ResolvedSchema {
  /** The merged schema at the path. Scalar-only `anyOf`/`oneOf` (e.g. int-or-string) is kept as is. */
  readonly schema: JsonSchema;
  /** The outermost `$ref`'d definition reached at this path, if any. */
  readonly defName?: string;
  /** Required property names, merged from the `$ref` target, every `allOf` member, the chosen `anyOf`/`oneOf` branch and the node itself. */
  readonly required: readonly string[];
  /**
   * The description. The node's own wins; otherwise the chosen branch's, then the last `allOf`
   * member's that has one, then the `$ref` target's.
   */
  readonly description?: string;
  /** For each property of `schema.properties`, the definition that declared it (when known). */
  readonly declaredIn?: Readonly<Record<string, string>>;
}

const MAX_DEPTH = 64;
const SCALAR_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'null']);

function isObj(v: unknown): v is JsonSchema {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typesOf(s: JsonSchema): string[] {
  const t = s['type'];
  return Array.isArray(t) ? (t as string[]) : typeof t === 'string' ? [t] : [];
}

/** Dynamic-value type name used to compare data against a schema `type`. */
function dataType(data: unknown): string {
  if (data === null) return 'null';
  if (Array.isArray(data)) return 'array';
  if (typeof data === 'number') return Number.isInteger(data) ? 'integer' : 'number';
  return typeof data;
}

function matchesType(s: JsonSchema, data: unknown): boolean {
  const ts = typesOf(s);
  if (ts.length === 0) return false;
  const dt = dataType(data);
  return ts.includes(dt) || (dt === 'integer' && ts.includes('number'));
}

function isStructural(s: JsonSchema): boolean {
  const ts = typesOf(s);
  return ts.includes('object') || ts.includes('array') || s['properties'] !== undefined || s['items'] !== undefined;
}

interface Flat {
  /** Built up while flattening, then handed out as a read-only {@link JsonSchema}. */
  schema: Record<string, unknown>;
  required: string[];
  declaredIn: Record<string, string>;
  defName: string | undefined;
}

function defsOf(root: JsonSchema): Record<string, unknown> {
  const d = root['$defs'];
  return isObj(d) ? d : {};
}

/**
 * Flattens `node`: follows `$ref`, merges `allOf`, and picks one `anyOf`/`oneOf` branch when the
 * alternatives are not all scalars. `outer` is the outermost definition reached so far; `cur` the
 * innermost one, which declares the node's own `properties`.
 */
function flatten(root: JsonSchema, node: JsonSchema, data: unknown, outer: string | undefined, cur: string | undefined, depth: number): Flat | undefined {
  if (depth > MAX_DEPTH) return undefined;
  const out: Flat = { schema: {}, required: [], declaredIn: {}, defName: outer };

  const absorb = (sub: Flat): void => {
    const { properties, patternProperties, required: _r, ...rest } = sub.schema as { properties?: JsonSchema; patternProperties?: JsonSchema; required?: unknown };
    Object.assign(out.schema, rest);
    if (isObj(properties)) out.schema['properties'] = { ...(out.schema['properties'] as JsonSchema | undefined), ...properties };
    if (isObj(patternProperties)) {
      out.schema['patternProperties'] = { ...(out.schema['patternProperties'] as JsonSchema | undefined), ...patternProperties };
    }
    for (const r of sub.required) if (!out.required.includes(r)) out.required.push(r);
    Object.assign(out.declaredIn, sub.declaredIn);
    out.defName ??= sub.defName;
  };

  const ref = node['$ref'];
  let own = cur;
  if (typeof ref === 'string') {
    const name = ref.startsWith('#/$defs/') ? ref.slice('#/$defs/'.length) : undefined;
    const target = name === undefined ? undefined : defsOf(root)[name];
    if (name === undefined || !isObj(target)) return undefined;
    const sub = flatten(root, target, data, outer ?? name, name, depth + 1);
    if (!sub) return undefined;
    absorb(sub);
    out.defName = outer ?? name;
    own = name;
  }

  const allOf = node['allOf'];
  if (Array.isArray(allOf)) {
    for (const m of allOf) {
      if (!isObj(m)) continue;
      const sub = flatten(root, m, data, out.defName ?? outer, own, depth + 1);
      if (sub) absorb(sub);
    }
  }

  for (const kw of ['anyOf', 'oneOf'] as const) {
    const alts = node[kw];
    if (!Array.isArray(alts)) continue;
    const branches = alts.filter(isObj).map((b) => flatten(root, b, data, out.defName ?? outer, own, depth + 1)).filter((b): b is Flat => b !== undefined);
    if (branches.length === 0) continue;
    const scalarOnly = branches.every((b) => typesOf(b.schema).every((t) => SCALAR_TYPES.has(t)) && !isStructural(b.schema));
    if (scalarOnly) {
      out.schema[kw] = alts;
      continue;
    }
    // Empty/null data (e.g. a bare `key:` while typing) still offers the structural branch's properties.
    const structural = (b: Flat): boolean => isStructural(b.schema);
    const chosen =
      (data === null || data === undefined ? branches.find(structural) : undefined) ??
      branches.find((b) => data !== undefined && matchesType(b.schema, data)) ??
      branches.find((b) => typesOf(b.schema).includes('object')) ??
      branches[0]!;
    absorb(chosen);
  }

  const { $ref: _ref, allOf: _a, anyOf: _any, oneOf: _one, properties, required, patternProperties, ...rest } = node as {
    $ref?: unknown; allOf?: unknown; anyOf?: unknown; oneOf?: unknown; properties?: unknown; required?: unknown; patternProperties?: unknown;
  } & JsonSchema;
  Object.assign(out.schema, rest);
  if (isObj(properties)) {
    out.schema['properties'] = { ...(out.schema['properties'] as JsonSchema | undefined), ...properties };
    if (own !== undefined) for (const k of Object.keys(properties)) out.declaredIn[k] = own;
  }
  if (isObj(patternProperties)) {
    out.schema['patternProperties'] = { ...(out.schema['patternProperties'] as JsonSchema | undefined), ...patternProperties };
  }
  if (Array.isArray(required)) for (const r of required) if (typeof r === 'string' && !out.required.includes(r)) out.required.push(r);
  return out;
}

function child(flat: Flat, seg: string | number): JsonSchema | undefined {
  if (typeof seg === 'number') {
    const items = flat.schema['items'];
    return isObj(items) ? items : undefined;
  }
  const props = flat.schema['properties'];
  if (isObj(props) && isObj(props[seg])) return props[seg];
  const patterns = flat.schema['patternProperties'];
  if (isObj(patterns)) {
    for (const [p, s] of Object.entries(patterns)) {
      try {
        if (isObj(s) && new RegExp(p).test(seg)) return s;
      } catch {
        // an invalid pattern never matches
      }
    }
  }
  const ap = flat.schema['additionalProperties'];
  return isObj(ap) ? ap : undefined;
}

function dataAt(data: unknown, seg: string | number): unknown {
  if (typeof seg === 'number') return Array.isArray(data) ? data[seg] : undefined;
  return isObj(data) ? data[seg] : undefined;
}

/**
 * Resolves the schema that applies at `path` inside the document `data`.
 *
 * Follows `$ref` into `$defs`, merges `allOf` members, takes `items` for numeric segments, and
 * `properties`, then matching `patternProperties`, then `additionalProperties` for keys.
 *
 * `anyOf`/`oneOf` are kept as they are when every branch is a scalar type. Otherwise one branch is
 * merged in: when the data at that point is null or missing (a bare `key:` being typed), the first
 * structural branch (object or array); else the first branch whose `type` matches the data; else
 * the first object branch; else the first branch.
 *
 * `required` is merged from the `$ref` target, every `allOf` member and the chosen branch. When
 * several `allOf` members carry a description, the last one wins (the node's own beats them all).
 * Pure: no caching.
 * @param bundle - Schema bundle whose root carries `$defs`.
 * @param path - Path from the document root.
 * @param data - The document as plain data, used to choose union branches.
 * @returns The resolved schema, or `undefined` when nothing resolves: a segment with no matching
 *   child schema, a `$ref` that is not local to `#/$defs/` (or names a missing definition), or
 *   nesting deeper than 64 levels (`MAX_DEPTH`, a guard against `$ref` cycles). An `allOf` member
 *   or branch that does not resolve is skipped.
 */
export function resolveAt(bundle: SchemaBundle, path: YamlPath, data: unknown): ResolvedSchema | undefined {
  const root = bundle.schema;
  let node: JsonSchema = root;
  let cur: unknown = data;
  let flat = flatten(root, node, cur, undefined, undefined, 0);
  for (const seg of path) {
    if (!flat) return undefined;
    const next = child(flat, seg);
    if (!next) return undefined;
    node = next;
    cur = dataAt(cur, seg);
    flat = flatten(root, node, cur, undefined, undefined, 0);
  }
  if (!flat) return undefined;
  const description = flat.schema['description'];
  return {
    schema: flat.schema,
    required: flat.required,
    declaredIn: flat.declaredIn,
    ...(flat.defName !== undefined && { defName: flat.defName }),
    ...(typeof description === 'string' && { description }),
  };
}
