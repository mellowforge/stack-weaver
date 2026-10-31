import type { YamlPath } from '../document/types.js';
import type { QuickFix } from '../formats/types.js';

/** How serious a problem is. Problems are ordered error, warning, info at the same position. */
export type Severity = 'error' | 'warning' | 'info';

/** Where a problem comes from: the YAML parser, the schema and document-shape checks, or a custom rule. */
export type ProblemSource = 'yaml' | 'schema' | 'rule';

/**
 * The code of a {@link Problem}: `yaml.syntax`, `yaml.warning`, `yaml.data`, `schema.<ajv keyword>`
 * (such as `schema.required`; also `schema.unavailable`), `kind.unknown`, `kind.apiVersion`,
 * `format.extraDocument`, or `rule.<id>` (a rule's finding; `rule.failed` when a rule threw).
 */
export type ProblemCode =
  | `yaml.${'syntax' | 'warning' | 'data'}`
  | `schema.${string}`
  | `kind.${'unknown' | 'apiVersion'}`
  | 'format.extraDocument'
  | `rule.${string}`;

/**
 * One problem in a document, with the exact source range it applies to: the validated,
 * editor-facing view that `validateText` reports. Parse problems (`ParsedText.errors` and
 * `warnings`, each a `YamlProblem`) arrive here with `source: 'yaml'`.
 */
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
  /** Stable machine-readable code; see {@link ProblemCode}. */
  readonly code: ProblemCode;
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

/**
 * Whether two problems are the same to a user: equal severity, code, message, document and range,
 * and the same fix (its `id` and a structural comparison of its action). `source`, `path`, `line`
 * and `col` follow from those and are not compared; neither is the fix label, which follows the
 * message table.
 */
export function sameProblem(a: Problem, b: Problem): boolean {
  return (
    a.severity === b.severity &&
    a.code === b.code &&
    a.message === b.message &&
    a.doc === b.doc &&
    a.from === b.from &&
    a.to === b.to &&
    a.fix?.id === b.fix?.id &&
    JSON.stringify(a.fix?.action) === JSON.stringify(b.fix?.action)
  );
}

/**
 * Whether two problem lists hold the same problems in the same order, by {@link sameProblem}.
 * @internal
 */
export function sameProblemList(a: readonly Problem[], b: readonly Problem[]): boolean {
  return a.length === b.length && a.every((p, i) => sameProblem(p, b[i]!));
}
