---
"@stack-weaver/core": minor
---

Adds compose variables, semantic rules and quick fixes.

Variables: compose placeholders (`${VAR}`, with `:-`, `-`, `:?`, `?`, `:+` and `+`) are replaced by their declared or inline default before schema checks, and a placeholder with no default is checked by its declared type only. Declare variables in a top-level `x-variables:` block (the default) or in a list the host owns, with the new `variables` option (`{ store: 'x-variables' }` or `{ store: 'external', value }`). The visual pane gets a Variables section and a "Use variable" toggle on each field that lists only fitting variables; the editor writes a bare `${VAR}` and keeps hand-written inline defaults. Read and change them with `onVariablesChange`, `getVariables()` and `setVariables()` (external store only).

Rules: `FormatDefinition.rules` runs semantic checks after schema validation, with problems coded `rule.<id>`. Kubernetes gets `service-selector`, `selector-mismatch`, `missing-resources` and `target-port`; compose gets `undeclared-variable`, `variable-default`, `variable-declaration` and `variable-type`. Rule messages resolve through the same table as schema messages, so `messages.schema` can override them.

Quick fixes: `Problem.fix` carries an optional one-click fix, shown as a Fix button in the problems panel, on visual rows and in the code pane (`CodeDiagnostic.actions`). Apply one yourself with `editor.applyFix(problem)`; it is one undo step.

Editing: `applyEdit` can now `add` and `delete` a pair in a single-line flow map (`{ a: 1, b: 2 }`), keeping the flow style.

Additive public API: `createManifestEditor` options `variables` and `onVariablesChange`; controller methods `getVariables`, `setVariables` and `applyFix`; `validateText` option `variables`; `Problem.fix`; types `VariablesOption`, `VariableStore`, `VariableType`, `VariableDecl`, `QuickFix`, `QuickFixAction`, `Rule`, `RuleInput` (including `message(key, params?)`), `RuleFinding`, `RuleFix` (a finding's quick fix: label key, `params` and action), `FormatVariables`, `CodeDiagnosticAction`; `FormatDefinition.rules` and `FormatDefinition.variables`; `CodeDiagnostic.actions`; and new `UiMessages` keys for the Variables section and the "Use variable" toggle.
