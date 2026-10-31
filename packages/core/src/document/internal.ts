import { isMap, isNode, isScalar, isSeq } from 'yaml';
import type { Document, LineCounter, Node, Pair, Scalar } from 'yaml';
import type { NodeRef, ParsedText, YamlPath } from './types.js';

// The `yaml`-typed side of a ParsedText lives under this module-private symbol, set only through
// `makeParsed` (by `parseText`), so the public type stays free of `yaml`. Everything exported here
// is internal: `index.ts` never re-exports from this module.
const YAML = Symbol('stack-weaver.yaml');

/** A parse's documents and line counter. */
interface YamlInternals {
  readonly docs: readonly Document.Parsed[];
  readonly lineCounter: LineCounter;
}

/**
 * Builds a {@link ParsedText} from `fields`, adding `docCount` and carrying `docs` and
 * `lineCounter` under the private symbol (non-enumerable). The handle and its `errors` and
 * `warnings` arrays are frozen.
 * @internal Called by `parseText` only.
 */
export function makeParsed(
  fields: Omit<ParsedText, 'docCount'>,
  docs: readonly Document.Parsed[],
  lineCounter: LineCounter,
): ParsedText {
  const p: ParsedText = { ...fields, errors: Object.freeze(fields.errors), warnings: Object.freeze(fields.warnings), docCount: docs.length };
  const internals: YamlInternals = { docs, lineCounter };
  Object.defineProperty(p, YAML, { value: internals, enumerable: false });
  return Object.freeze(p);
}

function internalsOf(p: ParsedText): YamlInternals {
  const y = (p as { [YAML]?: YamlInternals })[YAML];
  if (!y) throw new TypeError('stack-weaver: not a ParsedText from parseText');
  return y;
}

/** Whether `p` was made by `parseText` (never throws). */
export function isParsed(p: unknown): p is ParsedText {
  return typeof p === 'object' && p !== null && (p as { [YAML]?: YamlInternals })[YAML] !== undefined;
}

/**
 * Checks that `p` was made by `parseText`.
 * @throws A `TypeError` when it was not.
 */
export function assertParsed(p: ParsedText): void {
  internalsOf(p);
}

/**
 * The parsed documents of `p`, with source tokens kept for range-based edits.
 * @throws A `TypeError` when `p` was not made by `parseText`.
 */
export function yamlDocs(p: ParsedText): readonly Document.Parsed[] {
  return internalsOf(p).docs;
}

/**
 * The line counter `p` was parsed with, for offset to line/column mapping.
 * @throws A `TypeError` when `p` was not made by `parseText`.
 */
export function lineCounterOf(p: ParsedText): LineCounter {
  return internalsOf(p).lineCounter;
}

/** A map key's value: the scalar's value, or the key itself when it is not a scalar. */
export function keyOf(k: unknown): unknown {
  return isScalar(k) ? k.value : k;
}

function findPair(map: { items: Pair[] }, key: string | number): Pair | undefined {
  return map.items.find((pr) => {
    const v = keyOf(pr.key);
    return v === key || (v != null && String(v) === String(key));
  });
}

function walk(root: unknown, path: YamlPath): unknown {
  let cur: unknown = root;
  for (const seg of path) {
    if (isMap(cur)) {
      const pr = findPair(cur, seg);
      if (!pr) return undefined;
      cur = pr.value;
    } else if (isSeq(cur)) {
      if (typeof seg !== 'number') return undefined;
      cur = cur.items[seg];
    } else {
      // Scalars, aliases (never followed) and null have no children.
      return undefined;
    }
  }
  return cur;
}

/**
 * Resolves a reference to its node. Aliases are not followed: an alias node is returned as is,
 * and paths cannot pass through it.
 *
 * @param p - The parsed text.
 * @param ref - Document index and path.
 * @returns The node, or `undefined` when the document or path does not exist.
 * @throws A `TypeError` when `p` was not made by `parseText`.
 */
export function getNode(p: ParsedText, ref: NodeRef): Node | undefined {
  const doc = yamlDocs(p)[ref.doc];
  if (!doc) return undefined;
  const n = walk(doc.contents, ref.path);
  return isNode(n) ? n : undefined;
}

/**
 * Returns the key node of the map pair that holds `ref`.
 *
 * @param p - The parsed text.
 * @param ref - Reference to the pair's value.
 * @returns The key scalar, or `undefined` for roots, sequence items and non-scalar keys.
 * @throws A `TypeError` when `p` was not made by `parseText`.
 */
export function getPairKey(p: ParsedText, ref: NodeRef): Scalar | undefined {
  if (ref.path.length === 0) return undefined;
  const doc = yamlDocs(p)[ref.doc];
  if (!doc) return undefined;
  const parent = walk(doc.contents, ref.path.slice(0, -1));
  if (!isMap(parent)) return undefined;
  const pr = findPair(parent, ref.path[ref.path.length - 1]!);
  return pr && isScalar(pr.key) ? pr.key : undefined;
}

/**
 * What the map at `at` itself holds under `key` (not what it inherits through a `<<` merge).
 * @param p - The parsed text.
 * @param at - Reference to the map.
 * @param key - The key to look for.
 * @returns `undefined` when `at` is not a map or has no such pair of its own; otherwise whether the pair's value is a block or flow map (an alias or scalar is not).
 * @throws A `TypeError` when `p` was not made by `parseText`.
 */
export function ownMapValue(p: ParsedText, at: NodeRef, key: string): { readonly isMap: boolean } | undefined {
  const node = getNode(p, at);
  if (!isMap(node)) return undefined;
  const own = findPair(node, key);
  return own ? { isMap: isMap(own.value) } : undefined;
}
