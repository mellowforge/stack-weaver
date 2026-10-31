import { isAlias, isMap, isNode, isPair, isScalar, isSeq } from 'yaml';
import { lineCounterOf, yamlDocs } from './internal.js';
import type { NodeRef, ParsedText, Position } from './types.js';

function keyOf(k: unknown): unknown {
  return isScalar(k) ? k.value : k;
}

/**
 * True when `n`'s range holds `offset`. The end is inclusive, so a cursor just after a scalar
 * still selects it, except when the range ends with a line break: block collections and block
 * scalars end at the start of the next line, which belongs to the next node.
 */
function covers(text: string, n: unknown, offset: number): boolean {
  if (!isNode(n) || !n.range) return false;
  const [start, end] = n.range;
  const exclusive = end > start && text[end - 1] === '\n';
  return offset >= start && (exclusive ? offset < end : offset <= end);
}

function descend(text: string, node: unknown, offset: number, path: (string | number)[]): (string | number)[] {
  if (isMap(node)) {
    for (const pr of node.items) {
      if (!isPair(pr)) continue;
      // Map keys are always string segments: a number in a path means a sequence index.
      const key = String(keyOf(pr.key));
      if (covers(text, pr.value, offset)) return descend(text, pr.value, offset, [...path, key]);
      if (covers(text, pr.key, offset)) return [...path, key];
    }
  } else if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      if (covers(text, node.items[i], offset)) return descend(text, node.items[i], offset, [...path, i]);
    }
  }
  return path;
}

/**
 * Finds the deepest node whose source range contains `offset`. A hit on a map key yields the
 * path of that key's value. Aliases are not descended into. A node's range includes the offset
 * just after it, unless the range ends with a line break (block collections and block scalars):
 * column 1 of the following line belongs to the next node. Map keys are reported as strings, so
 * `8080:` gives the segment `"8080"`.
 *
 * @param p - The parsed text.
 * @param offset - UTF-16 offset into `p.text`.
 * @returns The reference, or `undefined` when the offset is outside every document's content.
 */
export function refAtOffset(p: ParsedText, offset: number): NodeRef | undefined {
  const docs = yamlDocs(p);
  for (let doc = 0; doc < docs.length; doc++) {
    const contents = docs[doc]!.contents;
    if (!covers(p.text, contents, offset) || isAlias(contents)) continue;
    return { doc, path: descend(p.text, contents, offset, []) };
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
export function toLineCol(p: ParsedText, offset: number): Position {
  return lineCounterOf(p).linePos(offset);
}
