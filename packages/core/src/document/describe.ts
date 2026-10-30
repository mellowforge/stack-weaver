import { isAlias, isMap, isScalar, isSeq } from 'yaml';
import type { Node } from 'yaml';
import { canEdit } from './edit.js';
import type { EditRefusal } from './edit.js';
import { getNode, getPairKey } from './paths.js';
import type { NodeRef, ParsedText, ScalarValue, TextRange } from './types.js';

/** A plain description of a node for views: kind, source ranges, content summary and editability. */
export interface NodeView {
  /** The node described. */
  readonly ref: NodeRef;
  /** What the node is: a mapping, a sequence, a scalar, or an alias (`*name`, never followed). */
  readonly type: 'map' | 'seq' | 'scalar' | 'alias';
  /** The value node's source range. */
  readonly range: TextRange;
  /** The key's source range, when the node is a map pair's value. */
  readonly keyRange?: TextRange;
  /** The scalar's value (scalars only). */
  readonly value?: ScalarValue;
  /** A map's keys in source order, as strings (a numeric key `8080` is `"8080"`; maps only). */
  readonly keys?: readonly string[];
  /** A sequence's item count (sequences only). */
  readonly length?: number;
  /** True for a flow collection (`{ }` / `[ ]`), or a node inside one. */
  readonly flow: boolean;
  /** The node's own anchor name, without the `&`. */
  readonly anchor?: string;
  /** Why the node cannot be edited (see {@link canEdit}); `undefined` when it is editable. */
  readonly readOnly?: EditRefusal;
}

const keyText = (k: unknown): string => String(isScalar(k) ? k.value : k);

function rangeOf(n: Node): TextRange {
  const [from, to] = n.range!;
  return { from, to };
}

/**
 * Describes the node at `ref` for rendering: its type, source ranges, scalar value, map keys or
 * sequence length, flow-ness, anchor and editability. Aliases are described, not followed.
 *
 * @param p - The parsed text.
 * @param ref - The node to describe.
 * @returns The description, or `undefined` when there is no node at `ref`.
 */
export function describeNode(p: ParsedText, ref: NodeRef): NodeView | undefined {
  const node = getNode(p, ref);
  if (!node?.range) return undefined;
  let flow = (isMap(node) || isSeq(node)) && node.flow === true;
  for (let i = 0; i < ref.path.length && !flow; i++) {
    const anc = getNode(p, { doc: ref.doc, path: ref.path.slice(0, i) });
    flow = (isMap(anc) || isSeq(anc)) && anc.flow === true;
  }
  const keyNode = getPairKey(p, ref);
  const readOnly = canEdit(p, ref);
  const base = {
    ref,
    range: rangeOf(node),
    ...(keyNode?.range ? { keyRange: rangeOf(keyNode) } : {}),
    flow,
    ...(!isAlias(node) && node.anchor ? { anchor: node.anchor } : {}),
    ...(readOnly ? { readOnly } : {}),
  };
  if (isMap(node)) return { ...base, type: 'map', keys: node.items.map((pr) => keyText(pr.key)) };
  if (isSeq(node)) return { ...base, type: 'seq', length: node.items.length };
  if (isScalar(node)) return { ...base, type: 'scalar', value: node.value as ScalarValue };
  return { ...base, type: 'alias' };
}
