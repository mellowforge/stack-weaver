import type { ParsedText } from '../document/types.js';
import { resourceNameOf } from '../formats/guide.js';
import type { Guide, GuideReference } from '../formats/types.js';
import { isRecord, safeData } from './util.js';

/** The guide's reference entry of `kind`, or `undefined` when the guide does not list it. */
export const referenceOf = (guide: Guide, kind: string): GuideReference | undefined =>
  guide.references !== undefined && Object.hasOwn(guide.references, kind) ? guide.references[kind] : undefined;

/** The documents of `p` that are a `kind`, as plain data. Documents that do not read are skipped. */
function documentsOf(p: ParsedText, kind: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let doc = 0; doc < p.docCount; doc++) {
    const data = safeData(p, doc);
    if (isRecord(data) && data['kind'] === kind) out.push(data);
  }
  return out;
}

/**
 * The name (the guide's `resourceLabel`) of every `kind` document in the same text, in document
 * order and without duplicates. Used to suggest names where one resource refers to another. Unreadable
 * text, documents without a name and kinds the guide's `references` do not list give nothing; this
 * never throws.
 * @param p - The parsed text.
 * @param guide - The guide; its `references` say which kinds can be referred to.
 * @param kind - The kind to list.
 * @returns The names; empty when there are none.
 */
export function suggestNames(p: ParsedText, guide: Guide, kind: string): string[] {
  if (!referenceOf(guide, kind)) return [];
  const names = documentsOf(p, kind).map((data) => resourceNameOf(guide, data));
  return [...new Set(names.filter((n): n is string => n !== undefined))];
}

/**
 * The keys of the `kind` document named `name` in the same text: the map keys under each of the
 * guide's `dataKeys` for that kind. In document order, without duplicates; never throws.
 * @param p - The parsed text.
 * @param guide - The guide; its `references[kind].dataKeys` say where the keys live.
 * @param kind - The kind of the document.
 * @param name - The document's name (the guide's `resourceLabel`).
 * @returns The keys; empty when no document matches or the guide does not list `kind`.
 */
export function suggestKeys(p: ParsedText, guide: Guide, kind: string, name: string): string[] {
  const reference = referenceOf(guide, kind);
  if (!reference) return [];
  const keys: string[] = [];
  for (const data of documentsOf(p, kind)) {
    if (resourceNameOf(guide, data) !== name) continue;
    for (const section of reference.dataKeys) {
      const map = data[section];
      if (isRecord(map)) keys.push(...Object.keys(map));
    }
  }
  return [...new Set(keys)];
}
