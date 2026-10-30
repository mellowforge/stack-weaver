import type { ParsedText } from '../document/types.js';

/** A JSON Schema document as plain data. */
export type JsonSchema = Record<string, unknown>;

/** One schema validation error, in ajv's shape. */
export interface SchemaError {
  /** JSON pointer to the failing instance location. */
  instancePath: string;
  /** The failing schema keyword. */
  keyword: string;
  /** Keyword-specific parameters. */
  params: Record<string, unknown>;
  /** Human-readable message, when the validator provides one. */
  message?: string;
}

/** Validates data against a schema. Returns `[]` when the data is valid. */
export type ValidateFn = (data: unknown) => SchemaError[];

/** A root schema (with `$defs`) paired with its validator. */
export interface SchemaBundle {
  /** Stable identifier of the bundle. */
  id: string;
  /** Root schema, carrying `$defs`. */
  schema: JsonSchema;
  /** Validator compiled from `schema`. */
  validate: ValidateFn;
}

/** A resource kind a format knows about. */
export interface KindEntry {
  id: string;
  apiVersion: string;
  kind: string;
  /** Name of the schema definition describing this kind. */
  defName: string;
  description: string;
}

/** Plain-language presentation hints for one schema property. */
export interface GuideField {
  label?: string;
  description?: string;
  recommended?: boolean;
  advanced?: boolean;
  order?: number;
  widget?: string;
  hidden?: boolean;
  example?: unknown;
}

/** A guide overlay: labels, intent groups and flags keyed by schema definition and property. */
export interface Guide {
  /** Intent groups, ordered by `order`. */
  groups: { id: string; label: string; order: number }[];
  /** Kind presentation, keyed like `"apps/v1/Deployment"`. */
  kinds: Record<string, { label: string; description: string; group: string; order?: number }>;
  /** Field hints, keyed `"<defName>#<property>"`. */
  fields: Record<string, GuideField>;
}

/** A registered document format (Kubernetes, compose, ...). */
export interface FormatDefinition {
  id: string;
  label: string;
  version: string;
  /** `'documents'` for multi-document resources, `'mapping'` for a single root mapping. */
  rootModel: 'documents' | 'mapping';
  /** True when the parsed text looks like this format. */
  detect(p: ParsedText): boolean;
  /** Known kinds; empty for `'mapping'` formats. */
  kinds(): readonly KindEntry[];
  /** Loads the schema for document `doc`; `undefined` means unknown kind. */
  loadSchema(p: ParsedText, doc: number): Promise<SchemaBundle | undefined>;
  /** The format's guide overlay. */
  guide: Guide;
}
