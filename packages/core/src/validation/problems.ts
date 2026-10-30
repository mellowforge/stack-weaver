import type { YamlPath } from '../document/types.js';

/** How serious a problem is. Problems are ordered error, warning, info at the same position. */
export type Severity = 'error' | 'warning' | 'info';

/** One problem in a document, with the exact source range it applies to. */
export interface Problem {
  /**
   * `error` for invalid content, `warning` for suspicious content (such as an unresolved tag),
   * `info` for notes (such as an unknown kind).
   */
  severity: Severity;
  /**
   * Where the problem comes from: the YAML parser (`yaml.*` codes), the schema and document-shape
   * checks (`schema.*`, `kind.*` and `format.*` codes), or a custom rule. `'rule'` is reserved for
   * the rule engine of a later plan; nothing reports it yet.
   */
  source: 'yaml' | 'schema' | 'rule';
  /**
   * Stable machine-readable code: `yaml.syntax`, `yaml.warning`, `yaml.data`, `schema.<ajv keyword>`
   * (e.g. `schema.required`), `schema.unavailable`, `kind.unknown`, `kind.apiVersion` or
   * `format.extraDocument`.
   */
  code: string;
  /** Human-readable message. */
  message: string;
  /** Zero-based index of the document the problem belongs to. */
  doc: number;
  /** Path of the offending value inside the document. */
  path: YamlPath;
  /** Start offset (UTF-16 index). */
  from: number;
  /** End offset (UTF-16 index). */
  to: number;
  /** 1-based line of `from`. */
  line: number;
  /** 1-based column of `from`. */
  col: number;
}

/** Sort rank of a severity; lower sorts first. */
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
