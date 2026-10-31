import { toData } from '../document/data.js';
import { getPairKey } from '../document/internal.js';
import { refAtOffset } from '../document/paths.js';
import type { ParsedText } from '../document/types.js';
import { fieldHint, firstSentence } from '../engine/addable.js';
import { resolveAt } from '../engine/resolve.js';
import type { Guide, SchemaBundle } from '../formats/types.js';

/** What to show when the pointer rests on a key. */
export interface HoverInfo {
  /** UTF-16 offset where the key starts. */
  readonly from: number;
  /** UTF-16 offset just after the key. */
  readonly to: number;
  /** The guide label, or the key itself. Plain text, never markup. */
  readonly title: string;
  /** The guide description, or the first sentence of the schema's; may be empty. Plain text, never markup. */
  readonly description: string;
  /** True when the schema requires the key. */
  readonly required: boolean;
}

/** The document as data, or `undefined` when it cannot be built (assist must never throw). */
function dataOf(p: ParsedText, doc: number): unknown {
  try {
    return toData(p, doc);
  } catch {
    return undefined;
  }
}

/**
 * Describes the key under `offset`.
 *
 * @param p - The parsed text.
 * @param offset - UTF-16 offset into `p.text`.
 * @param bundle - Schema of the document's kind; without it there is nothing to say.
 * @param guide - Guide overlay supplying labels and descriptions.
 * @returns The hover, or `undefined` when `offset` is not on a map key the schema knows.
 */
export function hoverAt(p: ParsedText, offset: number, bundle: SchemaBundle | undefined, guide: Guide): HoverInfo | undefined {
  if (!bundle) return undefined;
  const ref = refAtOffset(p, offset);
  const key = ref?.path[ref.path.length - 1];
  if (!ref || typeof key !== 'string') return undefined;
  const node = getPairKey(p, ref);
  if (!node?.range) return undefined;
  const [from, to] = node.range;
  if (offset < from || offset > to) return undefined;

  const data = dataOf(p, ref.doc);
  const parent = resolveAt(bundle, ref.path.slice(0, -1), data);
  if (!parent) return undefined;
  const child = resolveAt(bundle, ref.path, data);
  if (!child) return undefined;
  const hint = fieldHint(guide, parent, key);
  return {
    from,
    to,
    title: hint?.label ?? key,
    description: hint?.description ?? firstSentence(child.description),
    required: parent.required.includes(key),
  };
}

/**
 * The path from the document root to the node at `offset`, for a breadcrumb bar. The first entry
 * names the document: `<kind> <metadata.name>`, or the kind alone, or `Document <n>` (1-based).
 * The rest are the path segments as strings (sequence indexes too: `'0'`).
 *
 * @param p - The parsed text.
 * @param offset - UTF-16 offset into `p.text`.
 * @returns The segments; empty when `offset` is outside every document.
 */
export function breadcrumbAt(p: ParsedText, offset: number): readonly string[] {
  const ref = refAtOffset(p, offset);
  if (!ref) return [];
  return [documentTitle(dataOf(p, ref.doc), ref.doc), ...ref.path.map(String)];
}

function documentTitle(data: unknown, doc: number): string {
  const obj = (v: unknown): Record<string, unknown> | undefined =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  const root = obj(data);
  const kind = root?.['kind'];
  if (typeof kind !== 'string' || kind === '') return `Document ${doc + 1}`;
  const name = obj(root?.['metadata'])?.['name'];
  return typeof name === 'string' && name !== '' ? `${kind} ${name}` : kind;
}
