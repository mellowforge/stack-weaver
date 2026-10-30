import type { NodeRef, ParsedText, YamlValue } from '../document/types.js';

/** A JSON Schema document as plain data. */
export type JsonSchema = Record<string, unknown>;

/** One schema validation error, in ajv's shape. */
export interface SchemaError {
  /** JSON pointer to the failing instance location. */
  readonly instancePath: string;
  /** The failing schema keyword. */
  readonly keyword: string;
  /** Keyword-specific parameters. */
  readonly params: Readonly<Record<string, unknown>>;
  /** Human-readable message, when the validator provides one. */
  readonly message?: string;
}

/** Validates data against a schema. Returns `[]` when the data is valid. */
export type ValidateFn = (data: unknown) => SchemaError[];

/** A root schema (with `$defs`) paired with its validator. The schema is deep-frozen. */
export interface SchemaBundle {
  /** Stable identifier of the bundle. */
  readonly id: string;
  /** Root schema, carrying `$defs`. */
  readonly schema: JsonSchema;
  /** Validator compiled from `schema`. */
  readonly validate: ValidateFn;
}

/** A resource kind a format knows about. */
export interface KindEntry {
  /**
   * Stable id: `<group>_<version>_<Kind>`, with `core` as the group of the core API, e.g.
   * `apps_v1_Deployment` or `core_v1_Service`.
   */
  readonly id: string;
  /** The `apiVersion` written in documents: `<group>/<version>`, or just `<version>` for the core API (`v1`). */
  readonly apiVersion: string;
  /** The `kind` written in documents, e.g. `Deployment`. */
  readonly kind: string;
  /** Name of the schema definition describing this kind. */
  readonly defName: string;
  /** The schema's description of the kind (may be empty). */
  readonly description: string;
}

/** How prominently an addable item is offered. */
export type Tier = 'recommended' | 'common' | 'advanced';

/**
 * Plain-language presentation hints for one schema property. `tier` sets the property's tier in
 * `addableAt`: an entry with `tier` gives that tier; an entry without `tier` gives `'common'`;
 * a property with no entry at all gives `'advanced'`.
 */
export interface GuideField {
  /** Display label, replacing the property name. */
  readonly label?: string;
  /** Plain-language description, replacing the schema's own. */
  readonly description?: string;
  /** The tier this property is offered in (see the interface description for the defaults). */
  readonly tier?: Tier;
  /** Sort order within a tier, ascending; properties without one sort after, by name. */
  readonly order?: number;
  /** Name of a preferred input widget; interpreted by the UI layer. */
  readonly widget?: string;
  /** Never offer the property in `addableAt`. */
  readonly hidden?: boolean;
  /** Starting value used as the `valueTemplate` when the property is added. */
  readonly example?: YamlValue;
  /**
   * Suggested values for a string property (or the items of a string list) whose schema does not
   * list them, for example `imagePullPolicy`. They are suggestions only, never validation: the
   * visual editor offers them in a text input that still accepts any text, and the code editor
   * offers them as value completions.
   */
  readonly options?: readonly string[];
}

/** An intent group of the "Add resource" picker. */
export interface GuideGroup {
  /** Stable id, referenced by {@link GuideKind.group}. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Sort order, ascending. */
  readonly order: number;
}

/** Plain-language presentation of one resource kind. */
export interface GuideKind {
  /** Display label. */
  readonly label: string;
  /** One-line plain-language description. */
  readonly description: string;
  /** The id of the {@link GuideGroup} the kind belongs to. */
  readonly group: string;
  /** Sort order within the group, ascending. */
  readonly order?: number;
}

/** A guide overlay: labels, intent groups and flags keyed by schema definition and property. */
export interface Guide {
  /** Intent groups, ordered by `order`. */
  readonly groups: readonly GuideGroup[];
  /** Kind presentation, keyed by `kindKey(apiVersion, kind)`, like `"apps/v1/Deployment"`. */
  readonly kinds: Readonly<Record<string, GuideKind>>;
  /** Field hints, keyed `"<defName>#<property>"`. */
  readonly fields: Readonly<Record<string, GuideField>>;
}

/**
 * A partial guide to merge onto a base with `mergeGuide`. A `kinds` entry that still lacks
 * `label`, `description` or `group` after merging is dropped.
 */
export interface GuideOverride {
  /** Groups to add or replace, merged by `id`. */
  readonly groups?: readonly GuideGroup[];
  /** Kind overrides, merged per key. */
  readonly kinds?: Readonly<Record<string, Partial<GuideKind>>>;
  /** Field overrides, merged per key. */
  readonly fields?: Readonly<Record<string, Partial<GuideField>>>;
}

/** A starter document offered while the editor is empty. */
export interface Recipe {
  /** Stable id; a host recipe with the id of a built-in replaces it. */
  readonly id: string;
  /** The `id` of the format the recipe belongs to. */
  readonly format: string;
  /** Short card title. */
  readonly title: string;
  /** One-line plain-language description. */
  readonly description: string;
  /** The YAML text the recipe inserts; it should validate against its format. */
  readonly yaml: string;
  /** The value that most needs replacing (for example the container image); revealed after the recipe is chosen. */
  readonly focus?: NodeRef;
}

/** A registered document format (Kubernetes, compose, ...). Registered formats are deep-frozen. */
export interface FormatDefinition {
  /** Registry key, e.g. `'kubernetes'` or `'compose'`. */
  readonly id: string;
  /** Display name, e.g. `'Kubernetes'`. */
  readonly label: string;
  /**
   * Version of the schemas the format validates against; its meaning is per format: the
   * Kubernetes release (`'1.37.2'`) for Kubernetes, the short compose-spec commit for compose.
   */
  readonly version: string;
  /**
   * `'documents'` for multi-document resources; `'mapping'` for a single root mapping, where
   * `validateText` reports every non-empty document after the first as `format.extraDocument`.
   */
  readonly rootModel: 'documents' | 'mapping';
  /**
   * True when the parsed text looks like this format (empty documents should not count).
   * See `ParsedText.docs` for the `yaml` typing of the parsed documents.
   */
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
  readonly guide: Guide;
  /** Starter documents offered while the editor is empty. */
  readonly recipes?: readonly Recipe[];
}
