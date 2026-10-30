import type { ParsedText, YamlValue } from '../document/types.js';

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
  /**
   * Stable id: `<group>_<version>_<Kind>`, with `core` as the group of the core API, e.g.
   * `apps_v1_Deployment` or `core_v1_Service`.
   */
  id: string;
  /** The `apiVersion` written in documents: `<group>/<version>`, or just `<version>` for the core API (`v1`). */
  apiVersion: string;
  /** The `kind` written in documents, e.g. `Deployment`. */
  kind: string;
  /** Name of the schema definition describing this kind. */
  defName: string;
  /** The schema's description of the kind (may be empty). */
  description: string;
}

/**
 * Plain-language presentation hints for one schema property. `recommended` and `advanced` set the
 * property's tier in `addableAt`: `recommended: true` gives `'recommended'`; an entry without
 * either flag gives `'common'`; `advanced: true`, or no entry at all, gives `'advanced'`.
 */
export interface GuideField {
  /** Display label, replacing the property name. */
  label?: string;
  /** Plain-language description, replacing the schema's own. */
  description?: string;
  /** Offer the property in the `'recommended'` tier (takes precedence over `advanced`). */
  recommended?: boolean;
  /** Offer the property in the `'advanced'` tier. */
  advanced?: boolean;
  /** Sort order within a tier, ascending; properties without one sort after, by name. */
  order?: number;
  /** Name of a preferred input widget; interpreted by the UI layer. */
  widget?: string;
  /** Never offer the property in `addableAt`. */
  hidden?: boolean;
  /** Starting value used as the `valueTemplate` when the property is added. */
  example?: YamlValue;
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
  /** Registry key, e.g. `'kubernetes'` or `'compose'`. */
  id: string;
  /** Display name, e.g. `'Kubernetes'`. */
  label: string;
  /**
   * Version of the schemas the format validates against; its meaning is per format: the
   * Kubernetes release (`'1.37.2'`) for Kubernetes, the short compose-spec commit for compose.
   */
  version: string;
  /**
   * `'documents'` for multi-document resources; `'mapping'` for a single root mapping, where
   * `validateText` reports every non-empty document after the first as `format.extraDocument`.
   */
  rootModel: 'documents' | 'mapping';
  /** True when the parsed text looks like this format (empty documents should not count). */
  detect(p: ParsedText): boolean;
  /**
   * Known kinds; empty for `'mapping'` formats. For a `'documents'` format, a non-empty list makes
   * `validateText` check each document's shape (`apiVersion` / `kind`) and tell an unknown kind
   * from a known kind under a wrong `apiVersion`.
   */
  kinds(): readonly KindEntry[];
  /** Loads the schema for document `doc`; `undefined` means unknown kind. May reject (reported as `schema.unavailable`). */
  loadSchema(p: ParsedText, doc: number): Promise<SchemaBundle | undefined>;
  /** The format's guide overlay. */
  guide: Guide;
}
