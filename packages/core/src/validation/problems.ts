import type { YamlPath } from '../document/types.js';
import type { QuickFix } from '../formats/types.js';

/** How serious a problem is. Problems are ordered error, warning, info at the same position. */
export type Severity = 'error' | 'warning' | 'info';

/** Where a problem comes from: the YAML parser, the schema and document-shape checks, or a custom rule. */
export type ProblemSource = 'yaml' | 'schema' | 'rule';

/** One problem in a document, with the exact source range it applies to. */
export interface Problem {
  /**
   * `error` for invalid content, `warning` for suspicious content (such as an unresolved tag),
   * `info` for notes (such as an unknown kind).
   */
  readonly severity: Severity;
  /**
   * Where the problem comes from: the YAML parser (`yaml.*` codes), the schema and document-shape
   * checks (`schema.*`, `kind.*` and `format.*` codes), or a format's semantic rules (`rule.*`
   * codes).
   */
  readonly source: ProblemSource;
  /**
   * Stable machine-readable code: `yaml.syntax`, `yaml.warning`, `yaml.data`, `schema.<ajv keyword>`
   * (e.g. `schema.required`), `schema.unavailable`, `kind.unknown`, `kind.apiVersion`,
   * `format.extraDocument`, `rule.<id>` (a rule's finding) or `rule.failed` (a rule threw).
   */
  readonly code: string;
  /** Human-readable message. */
  readonly message: string;
  /** Zero-based index of the document the problem belongs to. */
  readonly doc: number;
  /** Path of the offending value inside the document. */
  readonly path: YamlPath;
  /** Start offset (UTF-16 index). */
  readonly from: number;
  /** End offset (UTF-16 index). */
  readonly to: number;
  /** 1-based line of `from`. */
  readonly line: number;
  /** 1-based column of `from`. */
  readonly col: number;
  /** A one-click fix, when the problem has one. */
  readonly fix?: QuickFix;
}

/** Sort rank of a severity; lower sorts first. */
export const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
