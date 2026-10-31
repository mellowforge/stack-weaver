import type { EditOp } from '../document/edit.js';
import type { NodeRef, ParsedText, TextRange, YamlPath, YamlValue } from '../document/types.js';
import type { Severity } from '../validation/problems.js';
import type { MessageFn } from '../validation/messages.js';
import type { VARIABLE_TYPES } from '../variables/decl.js';
import type { WidgetRef } from '../visual/widgets/types.js';

/** A JSON Schema document as plain data. Shallowly read-only (nested values are not typed read-only): copy it to change it. */
export type JsonSchema = Readonly<Record<string, unknown>>;

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
  /** The preferred input widget, by registry name and optional parameter; interpreted by the UI layer. */
  readonly widget?: WidgetRef;
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
  /** Keys whose string value labels a sequence item in the outline and field rows, first match wins. Default none. */
  readonly labelKeys?: readonly string[];
  /** Path whose string value labels a document next to its kind (`Deployment web`). Default none. */
  readonly resourceLabel?: YamlPath;
  /**
   * What the `ref` and `ref-key` widgets suggest, keyed by the referenced kind (the widget's `param`). A kind
   * that is not listed gets no suggestions.
   */
  readonly references?: Readonly<Record<string, GuideReference>>;
}

/** How documents of one kind are referred to by name and where they keep their keys. */
export interface GuideReference {
  /** The key, next to a `ref-key` field, that holds the referenced resource's name. */
  readonly nameKey: string;
  /** Top-level keys of the referenced document whose map keys are offered as `ref-key` suggestions. */
  readonly dataKeys: readonly string[];
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
  /** Replaces the base `labelKeys` whole. */
  readonly labelKeys?: readonly string[];
  /** Replaces the base `resourceLabel` whole. */
  readonly resourceLabel?: YamlPath;
  /** Reference entries, merged per kind: an entry replaces that kind's base entry. */
  readonly references?: Readonly<Record<string, GuideReference>>;
}

/** A starter document offered while the editor is empty. */
export interface Recipe {
  /** Stable id; a host recipe with the id of a built-in replaces it. */
  readonly id: string;
  /**
   * The `id` of the format the recipe belongs to: a built-in format or one of the editor's `formats`. A host recipe
   * naming any other id is not offered (the editor warns once). Its `yaml` should detect as this format.
   */
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
export type VariableType = (typeof VARIABLE_TYPES)[number];

/** What every variable declaration has, whatever its type. */
export interface VariableBase {
  /** The variable's name, as written in the placeholder. */
  readonly name: string;
  /** Plain-language description. */
  readonly description?: string;
}

/** A variable that holds text. */
export interface StringVariable extends VariableBase {
  /** The kind of value the variable holds. */
  readonly type: 'string';
  /** The value used when none is supplied. */
  readonly default?: string;
}

/** A variable that holds a number. */
export interface NumberVariable extends VariableBase {
  /** The kind of value the variable holds. */
  readonly type: 'number';
  /** The value used when none is supplied. */
  readonly default?: number;
}

/** A variable that holds `true` or `false`. */
export interface BooleanVariable extends VariableBase {
  /** The kind of value the variable holds. */
  readonly type: 'boolean';
  /** The value used when none is supplied. */
  readonly default?: boolean;
}

/** A variable that holds a port number (an integer from 1 to 65535). */
export interface PortVariable extends VariableBase {
  /** The kind of value the variable holds. */
  readonly type: 'port';
  /** The value used when none is supplied. */
  readonly default?: number;
}

/** A variable that holds one of a fixed list of strings. */
export interface EnumVariable extends VariableBase {
  /** The kind of value the variable holds. */
  readonly type: 'enum';
  /** The allowed values. Must not be empty; `validateVariableDecl` checks that at run time. */
  readonly enumValues: readonly string[];
  /** The value used when none is supplied; one of `enumValues`. */
  readonly default?: string;
}

/** One declared variable: a named placeholder value a document may reference. Narrow on `type`. */
export type VariableDecl = StringVariable | NumberVariable | BooleanVariable | PortVariable | EnumVariable;

/** What applying a {@link QuickFix} does. */
export type QuickFixAction =
  | { readonly kind: 'declareVariable'; readonly decl: VariableDecl }
  | { readonly kind: 'edit'; readonly ops: readonly EditOp[] };

/** A one-click fix attached to a problem. */
export interface QuickFix {
  /** Which fix this is: the rule's fix message key, such as `fix.declare-variable`. */
  readonly id: string;
  /** Button text. */
  readonly label: string;
  /** What the fix does. */
  readonly action: QuickFixAction;
}

/** What a format's `detect` sees. */
export interface DetectInput {
  /**
   * `toData` per document of the text: one entry per document, in order; `undefined` for an empty
   * or comment-only document and for one whose data cannot be built (for example `<<: 5`), so
   * `docs[i]` may be `undefined` for any `i`. Empty when the text does not parse. The data is merge-expanded (`<<` keys are applied), unlike the
   * raw tree that validation's `apiVersion` / `kind` shape check reads.
   */
  readonly docs: readonly unknown[];
}

/** What a {@link Rule} sees. */
export interface RuleInput {
  /** The parsed text; always `ok`. */
  readonly parsed: ParsedText;
  /**
   * `toData` per document: `parsed.docCount` entries, in order, never a hole; an explicit
   * `undefined` for empty, unbuildable or skipped documents.
   */
  readonly data: readonly unknown[];
  /** The bundle each document validated against: `parsed.docCount` entries; `undefined` where there was none. */
  readonly bundles: readonly (SchemaBundle | undefined)[];
  /** The variable declarations in effect. */
  readonly variables: readonly VariableDecl[];
  /**
   * Where `variables` came from. `'document'`: the format's own block (`FormatVariables.read`; in
   * the editor, the `'x-variables'` store). `'host'`: the list `validateText` was given in its
   * `variables` option (in the editor, the `'external'` store).
   */
  readonly variableSource: 'document' | 'host';
  /**
   * Formats an entry of the message table for this rule: the host's `messages` over the rule's own
   * `messages`. An unknown key gives the key itself (and a `console.warn`, once per rule and key).
   */
  message(key: string, params?: Readonly<Record<string, unknown>>): string;
  /**
   * The range of the value (or, with `at: 'key'`, the key) at `path` in document `doc`, for a
   * finding's `range`. A path that does not exist maps to its nearest existing ancestor, as a
   * finding's own `path` does; `at` defaults to `'value'`. `undefined` when `doc` is not a
   * document of the text.
   */
  locate(doc: number, path: YamlPath, at?: 'key' | 'value'): TextRange | undefined;
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
  /** A quick fix for the finding; `validateText` turns it into the problem's {@link QuickFix}. */
  readonly fix?: RuleFix;
}

/** The quick fix of a {@link RuleFinding}: what it does, and the message key of its label. */
export interface RuleFix {
  /** The message key of the button label, resolved through the same table as the rule's messages (so hosts can translate it). */
  readonly key: string;
  /** Parameters for the label message. */
  readonly params?: Readonly<Record<string, unknown>>;
  /** What applying the fix does. */
  readonly action: QuickFixAction;
}

/** A semantic check run after schema validation. Reports problems with code `rule.<id>`. */
export interface Rule {
  /**
   * Stable id; problems carry the code `rule.${id}`. `'failed'` is reserved (a throwing rule reports
   * `rule.failed`): a rule with that id is warned about once with `console.warn`.
   */
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

/**
 * A registered document format (Kubernetes, compose, ...). The built-in formats are deep-frozen;
 * `registerFormat` stores a host's object as given and does not freeze it.
 */
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
   * True when the text looks like this format. `input.docs` holds the plain data of each
   * document, merge-expanded; empty and unbuildable documents are `undefined` and should not count.
   */
  detect(input: DetectInput): boolean;
  /**
   * Known kinds; empty for `'mapping'` formats. For a `'documents'` format, a non-empty list makes
   * `validateText` check each document's shape (`apiVersion` / `kind`) and tell an unknown kind
   * from a known kind under a wrong `apiVersion`.
   */
  kinds(): readonly KindEntry[];
  /**
   * Loads the schema for a document, given its plain data (`toData`); `undefined` means unknown
   * kind. Called with whatever the document holds, so `data` may be any value. May reject
   * (reported as `schema.unavailable`). Choose the schema from the document-shape keys only
   * (`apiVersion` and `kind` for a `'documents'` format): the visual picker calls it with a
   * synthesised `{ apiVersion, kind }` stub to build a new document.
   */
  loadSchema(data: unknown): Promise<SchemaBundle | undefined>;
  /** The format's guide overlay. */
  readonly guide: Guide;
  /** Starter documents offered while the editor is empty. */
  readonly recipes?: readonly Recipe[];
  /** Semantic checks run by `validateText` after schema validation. */
  readonly rules?: readonly Rule[];
  /** Variable placeholder support; absent when the format has no variables. */
  readonly variables?: FormatVariables;
}
