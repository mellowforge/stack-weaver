import { isAlias, isMap, isNode, isPair, isScalar, isSeq } from 'yaml';
import type { Node, Pair, Scalar } from 'yaml';
import type { NodeRef, ParsedText, YamlPath } from './types.js';

function keyOf(k: unknown): unknown {
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
 */
export function getNode(p: ParsedText, ref: NodeRef): Node | undefined {
  const doc = p.docs[ref.doc];
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
 */
export function getPairKey(p: ParsedText, ref: NodeRef): Scalar | undefined {
  if (ref.path.length === 0) return undefined;
  const doc = p.docs[ref.doc];
  if (!doc) return undefined;
  const parent = walk(doc.contents, ref.path.slice(0, -1));
  if (!isMap(parent)) return undefined;
  const pr = findPair(parent, ref.path[ref.path.length - 1]!);
  return pr && isScalar(pr.key) ? pr.key : undefined;
}

function covers(n: unknown, offset: number): boolean {
  if (!isNode(n) || !n.range) return false;
  return offset >= n.range[0] && offset <= n.range[1];
}

function descend(node: unknown, offset: number, path: (string | number)[]): (string | number)[] {
  if (isMap(node)) {
    for (const pr of node.items) {
      if (!isPair(pr)) continue;
      const seg = keyOf(pr.key);
      const key = typeof seg === 'number' ? seg : String(seg);
      if (covers(pr.value, offset)) return descend(pr.value, offset, [...path, key]);
      if (covers(pr.key, offset)) return [...path, key];
    }
  } else if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      if (covers(node.items[i], offset)) return descend(node.items[i], offset, [...path, i]);
    }
  }
  return path;
}

/**
 * Finds the deepest node whose source range contains `offset`. A hit on a map key yields the
 * path of that key's value. Aliases are not descended into.
 *
 * @param p - The parsed text.
 * @param offset - UTF-16 offset into `p.text`.
 * @returns The reference, or `undefined` when the offset is outside every document's content.
 */
export function refAtOffset(p: ParsedText, offset: number): NodeRef | undefined {
  for (let doc = 0; doc < p.docs.length; doc++) {
    const contents = p.docs[doc]!.contents;
    if (!covers(contents, offset) || isAlias(contents)) continue;
    return { doc, path: descend(contents, offset, []) };
  }
  return undefined;
}

/**
 * Converts an offset to a 1-based line and column.
 *
 * @param p - The parsed text.
 * @param offset - UTF-16 offset into `p.text`.
 * @returns The 1-based position.
 */
export function toLineCol(p: ParsedText, offset: number): { line: number; col: number } {
  return p.lineCounter.linePos(offset);
}
