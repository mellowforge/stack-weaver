import type { ParsedText } from '../document/types.js';
import { isRecord, safeData } from './util.js';

/** The resource kinds whose names and keys other documents refer to. */
export type ReferenceKind = 'Secret' | 'ConfigMap';

/** The documents of `p` that are a `kind`, as plain data. Documents that do not read are skipped. */
function documentsOf(p: ParsedText, kind: ReferenceKind): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let doc = 0; doc < p.docs.length; doc++) {
    const data = safeData(p, doc);
    if (isRecord(data) && data['kind'] === kind) out.push(data);
  }
  return out;
}

const nameOf = (data: Record<string, unknown>): string | undefined => {
  const meta = data['metadata'];
  const name = isRecord(meta) ? meta['name'] : undefined;
  return typeof name === 'string' && name !== '' ? name : undefined;
};

/**
 * The `metadata.name` of every `kind` document in the same text, in document order and without
 * duplicates. Used to suggest names where one resource refers to another. Unreadable text and
 * documents without a name give nothing; this never throws.
 * @param p - The parsed text.
 * @param kind - The kind to list.
 * @returns The names; empty when there are none.
 */
export function suggestNames(p: ParsedText, kind: ReferenceKind): string[] {
  const names = documentsOf(p, kind).map(nameOf);
  return [...new Set(names.filter((n): n is string => n !== undefined))];
}

/**
 * The keys of the `kind` document named `name` in the same text: its `data` and `stringData` keys,
 * plus `binaryData` keys for a ConfigMap. In document order, without duplicates; never throws.
 * @param p - The parsed text.
 * @param kind - The kind of the document.
 * @param name - The document's `metadata.name`.
 * @returns The keys; empty when no document matches.
 */
export function suggestKeys(p: ParsedText, kind: ReferenceKind, name: string): string[] {
  const sections = kind === 'ConfigMap' ? ['data', 'stringData', 'binaryData'] : ['data', 'stringData'];
  const keys: string[] = [];
  for (const data of documentsOf(p, kind)) {
    if (nameOf(data) !== name) continue;
    for (const section of sections) {
      const map = data[section];
      if (isRecord(map)) keys.push(...Object.keys(map));
    }
  }
  return [...new Set(keys)];
}
