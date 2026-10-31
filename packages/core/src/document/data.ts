import { isScalar } from 'yaml';
import { yamlDocs } from './internal.js';
import type { ParsedText } from './types.js';

/**
 * Converts a parsed document to plain data for schema validation, with YAML merge keys (`<<`)
 * expanded. `parseText` leaves merges unresolved so the edit engine sees raw nodes; this helper
 * enables merge semantics on a clone, so the original document, its nodes and their source
 * ranges are never touched.
 *
 * @param p - The parsed text.
 * @param doc - Zero-based index of the document within `p`.
 * @returns The document as plain JS data, with `<<` merges applied.
 * @throws A `RangeError` when `doc` is not a document of `p`, and a `TypeError` when `p` was not
 *   made by `parseText`. Also throws when the data cannot be built: a merge source that is not a
 *   map (such as `<<: 5`), or more alias expansions than `yaml`'s limit of 100 allows (a guard
 *   against alias bombs). `validateText` reports these as `yaml.data` problems.
 */
export function toData(p: ParsedText, doc: number): unknown {
  const d = yamlDocs(p)[doc];
  if (!d) throw new RangeError(`No document at index ${doc}`);
  const copy = d.clone();
  // The YAML 1.2 core schema with merge enabled: scalars already carry their parsed values, and
  // 1.2 keeps `yes`/`no` and leading-zero numbers as the parser read them.
  copy.setSchema('1.2', { merge: true });
  return copy.toJS();
}

/**
 * True when a document has no content: nothing at all (comments only), or the empty null scalar
 * that a bare `---` produces. An explicit `null` or `~` is content. A `doc` that is not a document
 * of `p` counts as empty.
 * @internal Shared by validation and the format detectors; not part of the public API.
 */
export function isEmptyDocument(p: ParsedText, doc: number): boolean {
  const d = yamlDocs(p)[doc];
  if (!d) return true;
  const c = d.contents;
  if (c === null) return true;
  return isScalar(c) && c.value === null && !!c.range && c.range[0] === c.range[1];
}

/**
 * True when every document of `p` is empty (see {@link isEmptyDocument}), or there is none.
 * @internal Shared by the editor's format and recipe logic; not part of the public API.
 */
export function allDocumentsEmpty(p: ParsedText): boolean {
  for (let doc = 0; doc < p.docCount; doc++) if (!isEmptyDocument(p, doc)) return false;
  return true;
}
