import type { Document, LineCounter } from 'yaml';

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
  doc: number;
  /** Path from the document root to the node. */
  path: YamlPath;
}

/** A splice of the source text: replace `[from, to)` with `insert`. Offsets are UTF-16 indexes. */
export interface TextChange {
  /** Start of the replaced range in the old text (UTF-16 index, inclusive). */
  from: number;
  /** End of the replaced range in the old text (UTF-16 index, exclusive); equals `from` for a pure insertion. */
  to: number;
  /** The text that replaces `[from, to)`; empty for a pure deletion. */
  insert: string;
}

/** A parse problem with its source range and 1-based position. */
export interface YamlProblem {
  message: string;
  /** Start offset (UTF-16 index). */
  from: number;
  /** End offset (UTF-16 index). */
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 1-based column of `from`. */
  col: number;
}

/** The result of parsing YAML text. The original text is kept verbatim; it is never regenerated. */
export interface ParsedText {
  /** The exact source text that was parsed. */
  text: string;
  /** True when no document has errors. */
  ok: boolean;
  /** Parsed documents, with source tokens kept for range-based edits. */
  docs: Document.Parsed[];
  /** Line counter used to map offsets to line/column. */
  lineCounter: LineCounter;
  /** All errors across all documents, including aliases with no anchor before them. */
  errors: YamlProblem[];
  /** All parser warnings across all documents (for example an unresolved tag); they do not affect `ok`. */
  warnings: YamlProblem[];
  /** The first line ending found in the text, defaulting to `\n`. */
  eol: '\n' | '\r\n';
}

/** A range of the source text: `[from, to)` as UTF-16 indexes. */
export type TextRange = { readonly from: number; readonly to: number };
