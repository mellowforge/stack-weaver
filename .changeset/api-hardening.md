---
"@stack-weaver/core": minor
---

Hardens the public API before the framework wrappers. Most of it is breaking for code written against earlier 0.x types; read the lists below.

Breaking:

Document model
- `ParsedText` is an opaque handle (`text`, `ok`, `docCount`, `errors`, `warnings`, `eol`, all readonly); `ParsedText.docs` and `lineCounter` are gone, so read documents with `toData` / `describeNode`. Only a `ParsedText` made by `parseText` is valid: a copy or look-alike makes `toData`, `describeNode`, `refAtOffset` and `toLineCol` throw a `TypeError`, and `validateText` reject (`applyEdit` / `canEdit` refuse with `unsupported`).
- `getNode` is no longer exported; use `describeNode`.
- `TextRange`, `StoreEvent`, `StoreOptions` and `ParsedText` fields are `readonly`; `errors` / `warnings` are `readonly YamlProblem[]`; `JsonSchema` is `Readonly<Record<string, unknown>>` (shallowly read-only).
- A `ParsedText` and its `errors` / `warnings` arrays are frozen at runtime: assigning to them throws in strict mode.
- `applyEdit` and `canEdit` refuse a look-alike `ParsedText`, a non-object op or a malformed ref quietly (`unsupported`); any other internal failure is logged with `console.error` (was `console.debug`, and `canEdit` logged nothing) and still refused, never thrown.
- `EditResult`'s ok variant has a required `parsed` (the parse of the new text); code that builds an `EditResult` must supply it.
- `NodeView` is a union (`MapView | SeqView | ScalarView | AliasView`) and `CursorContext` is a union (`KeyCursor | ValueCursor`); `keys`, `length`, `value` and `key` exist only on their own member.
- `applyEdit` refuses `add` and `renameKey` with the key `<<` as `unsupported`, and `addDocument` on a text with no documents no longer writes a leading `---`.

Formats
- `FormatDefinition.detect` takes `DetectInput` (`{ docs }`, the `toData` of each document) and `loadSchema` takes the document's data, not a `ParsedText`.
- `RuleInput` gains `locate(doc, path, at?)`; hosts that build a `RuleInput` themselves must add it.
- `Guide` / `GuideOverride` gain optional `labelKeys`, `resourceLabel` and `references`: custom formats without them no longer get `name` / `metadata.name` labels in the outline and field rows, and a sequence item with an empty `name` falls back to "Item N".
- `registerFormat` no longer claims to freeze a host format (the TSDoc was wrong; built-ins stay frozen).
- `Rule.id` `'failed'` is reserved (a throwing rule reports `rule.failed`): a format whose rules use it gets one `console.warn`.
- `FormatDefinition.loadSchema` must choose the schema from the document-shape keys only (`apiVersion` / `kind` for a `'documents'` format): the visual picker calls it with a `{ apiVersion, kind }` stub.

Validation and variables
- `Problem.code` is the `ProblemCode` union and `QuickFix.id` is required (the rule's fix key).
- The controller's `applyFix` returns an `ActionResult` instead of a boolean. `ActionResult` is `{ ok: true } | { ok: false; reason: 'edit-refused'; edit: EditRefusal } | { ok: false; reason: <any other ActionRefusal> }`: `edit` is present exactly on `edit-refused`.
- `VariableStore` is no longer exported (no public value produces one; it is internal).
- `VariableDecl` is a union on `type`; `default` is typed per member and `enumValues` exists only on, and is required for, the enum member.
- A rule whose message table lacks its `rule.<id>` or fix key, or a key it passes to `RuleInput.message`, logs a `console.warn` (once per rule and key).
- A host message override (`messages.schema`) that throws falls back to the default message and logs a `console.warn` (once per key).

Editor
- `ManifestEditor` is renamed `ManifestEditorController` (no alias).
- The `format` option is settable at runtime (`setFormat`, `update`); under `format: 'auto'` the format is detected again when the text is set through the API and on undo and redo (typing never switches it).
- `getFormat()` returns the format option (`'auto'` or an id), so `setFormat(getFormat())` is a no-op; the resolved format id is `getActiveFormat()`. Do not confuse it with the root export `getFormat(id)`, which reads the global format registry (`registerFormat`), which the editor does not read.
- The problems array the editor publishes (`getProblems()`, `onProblemsChange`) is frozen.
- A host format whose `detect` throws is logged (`console.error`) and resolves to no format: `setFormat` and `update` no longer throw, and `ready` no longer rejects, because of it.
- An invalid `messages.locale` logs a `console.warn` once per editor (it still counts as `'en'`).
- A code editor that fails to load or mount after `destroy()` is logged with `console.error` (nothing is shown, and `ready` resolves).
- `setReadOnly`, `setTheme` and `setFormat` are no-ops when the value is current.
- A host recipe whose `format` is not a built-in id or one of `formats` is no longer offered (one `console.warn` per recipe).
- A host widget whose `focus()` throws is dropped (logged, the row shows the "input failed" note), and a throwing `destroy()` is logged instead of aborting the teardown of other rows.

Code editor adapter
- `CodeEditorAdapter.mount` and `CodeEditorInit.hover` may return a promise: hosts that call an adapter directly must await.
- `CodeDiagnostic` gains required `code` and `source`, and `CodeDiagnosticAction` a required `id`.

Widgets
- `WidgetRegistry` entries are `WidgetDefinition` objects `{ create, managesKeys? }`; a bare factory function is no longer accepted, and `defaultWidgets[name]` is a definition (`.create(ctx)`).
- `GuideField.widget` is a `WidgetRef` (`{ name, param? }`) instead of a `"name:param"` string.
- `WidgetContext` gains a required `guide()` and a required `locale`; widget contexts built by hand must supply them.

Messages
- `UiMessages` is readonly (`secretInvalidBase64` included); `problemsNone`, `problemsOne` and `problemsMany` are replaced by the plural message `problemCount`, `item` and `document` by the templates `itemLabel` and `documentLabel`; new keys `problemPrefix`, `variableDefaultDropped` and `formatBadge` (`'{label} {version}'`, the format badge) (hosts that supply a full `UiMessages` must add them).
- `PluralMessage` uses `none` for exactly 0; `zero` is only the CLDR plural category (Latvian selects it for 10, English never does). A table with `zero: 'No problems'` now shows "0 problems" in English: rename the key to `none`. The default `problemCount` is `{ none: 'No problems', one: '{count} problem', other: '{count} problems' }`.
- `{…}` placeholders are filled in one pass: all occurrences, and parameter text is never expanded again.
- `breadcrumbAt(p, offset, documentLabel?, guide?)` names a document by `metadata.name` only when it is given a guide with a `resourceLabel` (such as the format's `guide`); without one a document is named by its kind alone. `hoverAt` takes the guide as its last parameter (it never labelled documents).

Added:
- `ManifestEditorController.update(patch)`, `getFormat()`, `getActiveFormat()` and `setFormat(format)`; types `ManifestEditorUpdate`, `ActionResult`, `ActionRefusal`.
- `getVariables()` returns the same frozen array until the declarations change (safe for `useSyncExternalStore`-style identity checks).
- `DocumentStore.transact(ops)`, `reset(text)` and `clearHistory()`.
- `ParsedText.docCount`; types `DetectInput`, `MapView`, `SeqView`, `ScalarView`, `AliasView`, `KeyCursor`, `ValueCursor`.
- `sameProblem(a, b)` and the type `ProblemCode`.
- `VARIABLE_TYPES`, `validateVariableDecl`, `VariableDeclIssue` and the types `VariableBase`, `StringVariable`, `NumberVariable`, `BooleanVariable`, `PortVariable`, `EnumVariable`.
- `formatMessage`, `formatPlural`, the types `PluralMessage` and `MessageParams`, and `messages.locale` (plural rules by `Intl.PluralRules`; also `WidgetContext.locale`).
- `breadcrumbAt`'s `documentLabel` parameter (the `documentLabel` template).
- The type `SyncCodeEditorAdapter` (what `codemirrorAdapter()` returns), from the root and from `@stack-weaver/core/editors/codemirror`.
- `kindCatalog(format, guide?)`: the picker's catalog follows the host's guide override.
- TSDoc says which unions may grow (`ActionRefusal`, `ChangeOrigin`, `VariableDeclIssue`, `ProblemSource`: treat an unknown value as documented) and which are closed (`Severity`, `NodeView.type`, `CursorContext.position`).
- `WidgetDefinition`, `WidgetRef`, `GuideReference`, `Guide.labelKeys`, `Guide.resourceLabel` and `Guide.references`.
- `DocumentStore` adopts `EditResult.parsed`, saving one parse per visual edit.
