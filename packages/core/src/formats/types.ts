import type { EditOp } from '../document/edit.js';
import type { NodeRef, ParsedText, TextRange, YamlPath, YamlValue } from '../document/types.js';
import type { Severity } from '../validation/problems.js';
import type { MessageFn } from '../validation/messages.js';

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
  /**
   * The value that most needs replacing (for example the container image). After the recipe is
   * chosen it is selected in the code pane and the outline; in Visual and Split modes its field's
   * widget also gets keyboard focus (in Code mode focus stays where it is).
   */
  readonly focus?: NodeRef;
}

/** The type of a declared variable. */
export type VariableType = 'string' | 'number' | 'boolean' | 'port' | 'enum';

/** One declared variable: a named placeholder value a document may reference. */
export interface VariableDecl {
  /** The variable's name, as written in the placeholder. */
  readonly name: string;
  /** The kind of value the variable holds. */
  readonly type: VariableType;
  /** The allowed values when `type` is `'enum'`. */
  readonly enumValues?: readonly string[];
  /** The value used when none is supplied. */
  readonly default?: string | number | boolean;
  /** Plain-language description. */
  readonly description?: string;
}

/** What applying a {@link QuickFix} does. */
export type QuickFixAction =
  | { readonly kind: 'declareVariable'; readonly decl: VariableDecl }
  | { readonly kind: 'edit'; readonly ops: readonly EditOp[] };

/** A one-click fix attached to a problem. */
export interface QuickFix {
  /** Button text. */
  readonly label: string;
  /** What the fix does. */
  readonly action: QuickFixAction;
}

/** What a {@link Rule} sees. */
export interface RuleInput {
  /** The parsed text; always `ok`. */
  readonly parsed: ParsedText;
  /** `toData` per document; `undefined` for empty, unbuildable or skipped documents. */
  readonly data: readonly unknown[];
  /** The bundle each document validated against; `undefined` where there was none. */
  readonly bundles: readonly (SchemaBundle | undefined)[];
  /** The variable declarations in effect. */
  readonly variables: readonly VariableDecl[];
  /** Where `variables` came from: the document itself, or the host (`validateText`'s `variables` option). */
  readonly variableSource: 'document' | 'host';
}

/** One problem a {@link Rule} found; `validateText` turns it into a `Problem`. */
export interface RuleFinding {
  /** How serious the finding is. */
  readonly severity: Severity;
  /** Index of the document the finding belongs to. */
  readonly doc: number;
  /** Path of the offending value. A missing path maps to its nearest existing ancestor. */
  readonly path: YamlPath;
  /** Whether to point at the key or the value at `path`; default `'value'`. */
  readonly at?: 'key' | 'value';
  /** An exact range; wins over `path` and `at`. */
  readonly range?: TextRange;
  /** Parameters for the rule's message. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** A quick fix: `key` names a message (also resolved through the message table) used as its label. */
  readonly fix?: {
    readonly key: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly action: QuickFixAction;
  };
}

/** A semantic check run after schema validation. Reports problems with code `rule.<id>`. */
export interface Rule {
  /** Stable id; problems carry the code `rule.${id}`. */
  readonly id: string;
  /** Default messages for `rule.${id}` and every fix key the rule uses; hosts override by key. */
  readonly messages: Readonly<Record<string, MessageFn>>;
  /** Finds problems. A throw becomes one `rule.failed` error; other rules still run. */
  check(input: RuleInput): readonly RuleFinding[];
}

/** How a format reads, writes and substitutes variable placeholders. */
export interface FormatVariables {
  /** The root key of the in-document block that declares variables (for example `'x-variables'`). */
  readonly key: string;
  /** Reads the declarations from the document; valid entries only. */
  read(p: ParsedText): readonly VariableDecl[];
  /** Ops that add `decl` to the block, or replace the declaration named `replaces`; `undefined` if the text cannot take it. */
  writeOps(p: ParsedText, decl: VariableDecl, replaces?: string): readonly EditOp[] | undefined;
  /** Ops that remove the declaration named `name`. */
  removeOps(p: ParsedText, name: string): readonly EditOp[];
  /** The variable name when the whole scalar `value` is one placeholder. */
  referenceOf(value: string): string | undefined;
  /** The placeholder text for `name`, for example `'${NAME}'`. */
  reference(name: string): string;
  /**
   * Replaces placeholders in `data` by typed stand-ins so schema validation sees plausible values.
   * `skip` lists paths whose schema errors are dropped.
   */
  substitute(data: unknown, decls: readonly VariableDecl[]): { readonly data: unknown; readonly skip: readonly YamlPath[] };
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
  /** Semantic checks run by `validateText` after schema validation. */
  readonly rules?: readonly Rule[];
  /** Variable placeholder support; absent when the format has no variables. */
  readonly variables?: FormatVariables;
}
