/**
 * A path of map keys and sequence indexes from a document root to a node. A number always means a
 * sequence index; a map key is always a string, even when the YAML key is numeric (`8080:` is
 * addressed as `"8080"`).
 */
export type YamlPath = readonly (string | number)[];

/** A scalar value: what a `set` edit can write. */
export type ScalarValue = string | number | boolean | null;

/**
 * A JSON-like YAML value: a scalar, an array of values, or a plain object of values. Edits refuse
 * anything else at runtime (functions, symbols, bigints, `Date`, `Map`, class instances,
 * `undefined` at any depth, sparse arrays and cycles).
 */
export type YamlValue = ScalarValue | readonly YamlValue[] | { readonly [k: string]: YamlValue };

/** Addresses a node: the document index within the text plus a path inside it. */
export interface NodeRef {
  /** Zero-based index of the YAML document within the text. */
  readonly doc: number;
  /** Path from the document root to the node. */
  readonly path: YamlPath;
}

/** A splice of the source text: replace `[from, to)` with `insert`. Offsets are UTF-16 indexes. */
export interface TextChange {
  /** Start of the replaced range in the old text (UTF-16 index, inclusive). */
  readonly from: number;
  /** End of the replaced range in the old text (UTF-16 index, exclusive); equals `from` for a pure insertion. */
  readonly to: number;
  /** The text that replaces `[from, to)`; empty for a pure deletion. */
  readonly insert: string;
}

/**
 * A parse problem with its source range and 1-based position, as `parseText` reports it in
 * `ParsedText.errors` and `warnings`. It belongs to the parse layer: no severity, source, code or
 * path. `validateText` turns each one into an editor-facing `Problem` (`source: 'yaml'`).
 */
export interface YamlProblem {
  /** The parser's description of the problem (plain text). */
  readonly message: string;
  /** Start offset (UTF-16 index). */
  readonly from: number;
  /** End offset (UTF-16 index). */
  readonly to: number;
  /** 1-based line of `from`. */
  readonly line: number;
  /** 1-based column of `from`. */
  readonly col: number;
}

/**
 * The result of parsing YAML text, made only by `parseText`. The original text is kept verbatim;
 * it is never regenerated. An opaque handle: the parsed documents stay inside it, read through
 * `toData`, `describeNode` and `refAtOffset`. Pass it on as returned: a copy (`{ ...p }`) or an
 * object literal of the same shape is not a `ParsedText` that those functions accept.
 */
export interface ParsedText {
  /** The exact source text that was parsed. */
  readonly text: string;
  /** True when no document has errors. */
  readonly ok: boolean;
  /**
   * How many YAML documents the text holds, empty ones included (`a: 1\n---\n---\nb: 2\n` holds
   * three); comment-only or empty text holds none. Document indexes run from 0 to `docCount - 1`.
   */
  readonly docCount: number;
  /** All errors across all documents, including aliases with no anchor before them. */
  readonly errors: readonly YamlProblem[];
  /** All parser warnings across all documents (for example an unresolved tag); they do not affect `ok`. */
  readonly warnings: readonly YamlProblem[];
  /** The first line ending found in the text, defaulting to `\n`. */
  readonly eol: '\n' | '\r\n';
}

/** A range of the source text: `[from, to)` as UTF-16 indexes. */
export type TextRange = { readonly from: number; readonly to: number };

/** A 1-based line and column in the source text. */
export interface Position {
  /** 1-based line. */
  readonly line: number;
  /** 1-based column. */
  readonly col: number;
}
