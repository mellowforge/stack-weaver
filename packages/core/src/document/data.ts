import type { Document } from 'yaml';

/**
 * Converts a parsed document to plain data for schema validation, with YAML merge keys (`<<`)
 * expanded. `parseText` leaves merges unresolved so the edit engine sees raw nodes; this helper
 * enables merge semantics on a clone, so the original document, its nodes and their source
 * ranges are never touched.
 *
 * @param doc - A document from `parseText`.
 * @returns The document as plain JS data, with `<<` merges applied.
 */
export function toData(doc: Document.Parsed): unknown {
  const copy = doc.clone();
  // The YAML 1.2 core schema with merge enabled: scalars already carry their parsed values, and
  // 1.2 keeps `yes`/`no` and leading-zero numbers as the parser read them.
  copy.setSchema('1.2', { merge: true });
  return copy.toJS();
}
