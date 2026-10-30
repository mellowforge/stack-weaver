// Normalizes Kubernetes OpenAPI v3 `components.schemas` into JSON Schema 2020-12 `$defs`.
// Pure functions, shared by gen-kubernetes.mjs and the unit tests.

/** Name of the apimachinery Quantity definition, which rule 3 replaces wholesale. */
export const QUANTITY_DEF = 'io.k8s.apimachinery.pkg.api.resource.Quantity';

/** Quantity grammar (signed decimal number with an optional SI, binary-SI or exponent suffix). */
export const QUANTITY_PATTERN = '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+|[numkMGTPE]i?|[KMGTPE]i)?$';

const GVK_KEY = 'x-kubernetes-group-version-kind';
const COMPONENT_REF = '#/components/schemas/';
const DEF_REF = '#/$defs/';

// Keywords whose value is a map of name -> schema. Their keys are data (property names may be
// "nullable", "format" or "x-kubernetes-int-or-string", as in CRD JSONSchemaProps).
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);
// Keywords whose value is one schema.
const SCHEMA_VALUES = new Set([
  'items', 'additionalProperties', 'additionalItems', 'not', 'if', 'then', 'else', 'contains',
  'propertyNames', 'unevaluatedItems', 'unevaluatedProperties',
]);
// Keywords whose value is an array of schemas.
const SCHEMA_ARRAYS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);

/**
 * Returns the single group-version-kind of a kind root, or `undefined` when `name` is not an
 * included kind: it needs exactly one GVK, a kind not ending in `List`, a name outside
 * `io.k8s.apimachinery.pkg.apis.meta`, and a GA (non alpha/beta) version.
 * @param {string} name
 * @param {Record<string, unknown>} def
 * @returns {{ group: string, version: string, kind: string } | undefined}
 */
export function kindGvk(name, def) {
  const gvks = def?.[GVK_KEY];
  if (!Array.isArray(gvks) || gvks.length !== 1) return undefined;
  const { group = '', version, kind } = gvks[0];
  if (typeof version !== 'string' || typeof kind !== 'string') return undefined;
  if (kind.endsWith('List')) return undefined;
  if (name.startsWith('io.k8s.apimachinery.pkg.apis.meta')) return undefined;
  if (/alpha|beta/.test(version)) return undefined;
  return { group, version, kind };
}

/** `apiVersion` string for a group-version (`v1` for the core group). */
export function apiVersionOf({ group, version }) {
  return group ? `${group}/${version}` : version;
}

/** Stable kind id: `<group or "core">_<version>_<Kind>`. */
export function kindId({ group, version, kind }) {
  return `${group || 'core'}_${version}_${kind}`;
}

/**
 * Applies the normalization rules to every definition and returns a new map (input untouched):
 * 1. `#/components/schemas/X` refs become `#/$defs/X`;
 * 2. `format: int-or-string` / `x-kubernetes-int-or-string: true` become an integer|string `anyOf`;
 * 3. the Quantity definition becomes a pattern-checked string or a number;
 * 4. `nullable: true` adds `'null'` to `type`;
 * 5. `x-kubernetes-*` keys are dropped except `x-kubernetes-group-version-kind`;
 * 6. each kind root (see {@link kindGvk}) gets `apiVersion`/`kind` consts and requires
 *    `apiVersion`, `kind` and `metadata`. Pass `{ kindRoots: false }` to skip rule 6, for
 *    definitions that are embedded in other kinds (e.g. a PersistentVolumeClaim template).
 * @param {Record<string, Record<string, unknown>>} components
 * @param {{ kindRoots?: boolean }} [options]
 * @returns {Record<string, Record<string, unknown>>}
 */
export function normalizeK8s(components, { kindRoots = true } = {}) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  for (const [name, def] of Object.entries(components)) {
    let n = normalizeSchema(def);
    if (name === QUANTITY_DEF) n = quantity(n);
    if (kindRoots) {
      const gvk = kindGvk(name, def);
      if (gvk) n = kindRoot(n, gvk);
    }
    out[name] = n;
  }
  return out;
}

/**
 * Rule 6 on one (already normalized) definition: `apiVersion`/`kind` consts, keeping their
 * descriptions, and `apiVersion`, `kind`, `metadata` added to `required`.
 * @param {Record<string, unknown>} def
 * @param {{ group: string, version: string, kind: string }} gvk
 */
export function kindRoot(def, gvk) {
  const properties = /** @type {Record<string, Record<string, unknown>>} */ ({ ...(def.properties ?? {}) });
  properties.apiVersion = { ...(properties.apiVersion ?? { type: 'string' }), const: apiVersionOf(gvk) };
  properties.kind = { ...(properties.kind ?? { type: 'string' }), const: gvk.kind };
  const required = [...(Array.isArray(def.required) ? def.required : [])];
  for (const r of ['apiVersion', 'kind', 'metadata']) if (!required.includes(r)) required.push(r);
  return { ...def, properties, required };
}

/** Rule 3: the Quantity definition, keeping its description. */
function quantity(def) {
  const out = {};
  if (def.description !== undefined) out.description = def.description;
  out.anyOf = [{ type: 'string', pattern: QUANTITY_PATTERN }, { type: 'number' }];
  return out;
}

/** Rules 1, 2, 4 and 5 on one schema node, recursively. */
function normalizeSchema(node) {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (!isObject(node)) return node;

  const intOrString = node.format === 'int-or-string' || node['x-kubernetes-int-or-string'] === true;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('x-kubernetes-') && key !== GVK_KEY) continue; // rule 5
    if (key === 'nullable') continue; // rule 4, handled below
    if (intOrString && (key === 'type' || key === 'format' || key === 'oneOf' || key === 'anyOf')) continue; // rule 2
    if (key === '$ref' && typeof value === 'string' && value.startsWith(COMPONENT_REF)) {
      out.$ref = DEF_REF + value.slice(COMPONENT_REF.length); // rule 1
    } else if (SCHEMA_MAPS.has(key) && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeSchema(v)]));
    } else if ((SCHEMA_VALUES.has(key) || SCHEMA_ARRAYS.has(key)) && typeof value === 'object' && value !== null) {
      out[key] = normalizeSchema(value);
    } else {
      out[key] = structuredClone(value); // data: default, enum, const, description, GVK, ...
    }
  }
  if (intOrString) out.anyOf = [{ type: 'integer' }, { type: 'string' }];
  if (node.nullable === true && out.type !== undefined) {
    const types = Array.isArray(out.type) ? out.type : [out.type];
    out.type = types.includes('null') ? types : [...types, 'null'];
  }
  return out;
}

/**
 * Returns the definitions reachable from `rootName` through `#/$defs/` refs, the root included,
 * keyed like `defs` (values are the same objects, not copies). Throws on a dangling ref.
 * @param {Record<string, Record<string, unknown>>} defs
 * @param {string} rootName
 * @returns {Record<string, Record<string, unknown>>}
 */
export function collectReachable(defs, rootName) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {};
  const queue = [rootName];
  while (queue.length > 0) {
    const name = /** @type {string} */ (queue.pop());
    if (name in out) continue;
    const def = defs[name];
    if (!def) throw new Error(`collectReachable: missing definition "${name}" (reached from "${rootName}")`);
    out[name] = def;
    for (const ref of refsOf(def)) if (!(ref in out)) queue.push(ref);
  }
  return out;
}

/** Names referenced through `#/$defs/<name>` anywhere inside `node`. */
export function refsOf(node, acc = new Set()) {
  if (Array.isArray(node)) for (const v of node) refsOf(v, acc);
  else if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string' && value.startsWith(DEF_REF)) acc.add(value.slice(DEF_REF.length));
      else if (typeof value === 'object' && value !== null) refsOf(value, acc);
    }
  }
  return acc;
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
