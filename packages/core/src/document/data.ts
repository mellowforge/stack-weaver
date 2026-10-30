import { isScalar } from 'yaml';
import type { Document } from 'yaml';

/**
 * Converts a parsed document to plain data for schema validation, with YAML merge keys (`<<`)
 * expanded. `parseText` leaves merges unresolved so the edit engine sees raw nodes; this helper
 * enables merge semantics on a clone, so the original document, its nodes and their source
 * ranges are never touched.
 *
 * @param doc - A document from `parseText`.
 * @returns The document as plain JS data, with `<<` merges applied.
 * @throws When the data cannot be built: a merge source that is not a map (such as `<<: 5`), or
 *   more alias expansions than `yaml`'s limit of 100 allows (a guard against alias bombs).
 *   `validateText` reports these as `yaml.data` problems.
 */
export function toData(doc: Document.Parsed): unknown {
  const copy = doc.clone();
  // The YAML 1.2 core schema with merge enabled: scalars already carry their parsed values, and
  // 1.2 keeps `yes`/`no` and leading-zero numbers as the parser read them.
  copy.setSchema('1.2', { merge: true });
  return copy.toJS();
}

/**
 * True when a document has no content: nothing at all (comments only), or the empty null scalar
 * that a bare `---` produces. An explicit `null` or `~` is content.
 * @internal Shared by validation and the format detectors; not part of the public API.
 */
export function isEmptyDocument(doc: Document.Parsed): boolean {
  const c = doc.contents;
  if (c === null) return true;
  return isScalar(c) && c.value === null && !!c.range && c.range[0] === c.range[1];
}
