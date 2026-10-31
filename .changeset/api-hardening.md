---
"@stack-weaver/core": minor
---

Hardens the public API before the framework wrappers. Most of it is breaking for code written against earlier 0.x types; read the lists below.

Breaking:

Document model
- `ParsedText` is an opaque handle (`text`, `ok`, `docCount`, `errors`, `warnings`, `eol`, all readonly); `ParsedText.docs` and `lineCounter` are gone, so read documents with `toData` / `describeNode`. Only a `ParsedText` made by `parseText` is valid: a copy or look-alike makes `toData`, `describeNode`, `refAtOffset` and `toLineCol` throw a `TypeError`, and `validateText` reject (`applyEdit` / `canEdit` refuse with `unsupported`).
- `getNode` is no longer exported; use `describeNode`.
- `TextRange`, `StoreEvent`, `StoreOptions` and `ParsedText` fields are `readonly`; `errors` / `warnings` are `readonly YamlProblem[]`; `JsonSchema` is `Readonly<Record<string, unknown>>`.
- `EditResult`'s ok variant has a required `parsed` (the parse of the new text); code that builds an `EditResult` must supply it.
- `NodeView` is a union (`MapView | SeqView | ScalarView | AliasView`) and `CursorContext` is a union (`KeyCursor | ValueCursor`); `keys`, `length`, `value` and `key` exist only on their own member.
- `applyEdit` refuses `add` and `renameKey` with the key `<<` as `unsupported`, and `addDocument` on a text with no documents no longer writes a leading `---`.

Formats
- `FormatDefinition.detect` takes `DetectInput` (`{ docs }`, the `toData` of each document) and `loadSchema` takes the document's data, not a `ParsedText`.
- `RuleInput` gains `locate(doc, path, at?)`; hosts that build a `RuleInput` themselves must add it.
- `Guide` / `GuideOverride` gain optional `labelKeys`, `resourceLabel` and `references`: custom formats without them no longer get `name` / `metadata.name` labels in the outline and field rows, and a sequence item with an empty `name` falls back to "Item N".
- `registerFormat` no longer claims to freeze a host format (the TSDoc was wrong; built-ins stay frozen).

Validation and variables
- `Problem.code` is the `ProblemCode` union and `QuickFix.id` is required (the rule's fix key).
- `VariableStore.set`, `VariableStore.remove` and the controller's `applyFix` return an `ActionResult` instead of a boolean.
- `VariableDecl` is a union on `type`; `default` is typed per member and `enumValues` exists only on, and is required for, the enum member.
- A rule whose message table lacks its `rule.<id>` or fix key logs a `console.warn` (once per rule and key).

Editor
- `ManifestEditor` is renamed `ManifestEditorController` (no alias).
- The `format` option is settable at runtime (`setFormat`, `update`); under `format: 'auto'` the format is detected again when the text is set through the API.
- `setReadOnly`, `setTheme` and `setFormat` are no-ops when the value is current.
- A host recipe whose `format` is not a built-in id or one of `formats` is no longer offered (one `console.warn`).
- A host widget whose `focus()` throws is dropped (logged, the row shows the "input failed" note), and a throwing `destroy()` is logged instead of aborting the teardown of other rows.

Code editor adapter
- `CodeEditorAdapter.mount` and `CodeEditorInit.hover` may return a promise: hosts that call an adapter directly must await.
- `CodeDiagnostic` gains required `code` and `source`, and `CodeDiagnosticAction` a required `id`.

Widgets
- `WidgetRegistry` entries are `WidgetDefinition` objects `{ create, managesKeys? }`; a bare factory function is no longer accepted, and `defaultWidgets[name]` is a definition (`.create(ctx)`).
- `GuideField.widget` is a `WidgetRef` (`{ name, param? }`) instead of a `"name:param"` string.
- `WidgetContext` gains a required `guide()`; widget contexts built by hand must supply it.

Messages
- `UiMessages` is readonly; `problemsNone`, `problemsOne` and `problemsMany` are replaced by the plural message `problemCount`, `item` and `document` by the templates `itemLabel` and `documentLabel`; new keys `problemPrefix` and `variableDefaultDropped` (hosts that supply a full `UiMessages` must add them).
- `{name}` placeholders are filled in one pass: all occurrences, and parameter text is never expanded again.
- `breadcrumbAt` and `hoverAt` label a document by `metadata.name` only when given guide data (the format's `guide`); without it a document is named by its kind alone.

Added:
- `ManifestEditorController.update(patch)`, `getFormat()` and `setFormat(format)`; types `ManifestEditorUpdate`, `ActionResult`, `ActionRefusal`.
- `DocumentStore.transact(ops)`, `reset(text)` and `clearHistory()`.
- `ParsedText.docCount`; types `DetectInput`, `MapView`, `SeqView`, `ScalarView`, `AliasView`, `KeyCursor`, `ValueCursor`.
- `sameProblem(a, b)` and the type `ProblemCode`.
- `VARIABLE_TYPES`, `validateVariableDecl`, `VariableDeclIssue` and the member types `StringVariable`, `NumberVariable`, `BooleanVariable`, `PortVariable`, `EnumVariable`.
- `formatMessage`, `formatPlural`, the type `PluralMessage` and `messages.locale` (plural rules by `Intl.PluralRules`).
- `WidgetDefinition`, `WidgetRef`, `GuideReference`, `Guide.labelKeys`, `Guide.resourceLabel` and `Guide.references`.
- `applyEdit` logs unexpected failures with `console.debug`, and `DocumentStore` adopts `EditResult.parsed`, saving one parse per visual edit.
