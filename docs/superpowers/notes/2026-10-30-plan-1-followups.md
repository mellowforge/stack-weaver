# Plan 1 (headless core): carried-forward follow-ups

These are decisions and deferred work from the Plan 1 execution and its milestone review, which used the pr-review-toolkit panel. Later plans must pick them up.

## Plan 1 follow-ups: status after Plan 2
The editor UI (Plan 2) took most of the "API hardening" list. Done means shipped and tested in Plan 2.

**Done in Plan 2**
- `GuideOverride` for `mergeGuide`, and `GuideField.tier` replacing `recommended`/`advanced`.
- Mutability: `readonly` public types, and the exported formats and guides are frozen.
- Named types (`GuideGroup`, `GuideKind`, `KindCatalog`, `Position`, `ProblemSource`, `TextRange`) and a `kindKey()` helper.
- Edit operations: `deleteDocument`, and an `'api'` origin (`ChangeOrigin` is `'visual' | 'code' | 'api' | 'history'`).
- Subpath exports trimmed to the format definition (`kubernetesFormat`, `composeFormat`).
- Spec wording: the Host API now lists `UiMessages` and `SchemaMessages`, with the Plan 2 rulings and the CSS tokens.
- Engine gaps the UI had to cover: the key-value widget offers "add key", sequence items are labelled "Item N" (or by their `name`), and an anchored scalar shows a note that an edit changes every alias.
- `describeNode(p, ref)`, a read view of a node that the UI uses instead of yaml types.

**Carried forward (Plan 2 had no consumer for these)**
- **Full `yaml` decoupling.** `describeNode` exists, but `FormatDefinition.detect` and `loadSchema` still take a `ParsedText`, and `toData(p, doc)` is public. Either make them take plain data, or re-export the yaml guards, before the wrappers (Plan 4) freeze the API.
- **`DocumentStore`:** `reset(text)`, `clearHistory()` and `transact` (or `edit(ops[])`) were not added. The UI never needed grouped edits, and `setValue` goes through a minimal diff. Add them when a host or wrapper needs to drop undo history or group an edit.
- **`ResolvedSchema` aliasing:** it must not alias cached bundle internals. Confirm this when the freeze work is next touched.
- **`EditResult`** does not return the new `parsed` or the ref of the created node.
- **Consider replacing `YamlProblem` with `Problem`.**

## Plan 4: API hardening before wrappers
Deferred by ruling R10 from the Plan 2 milestone review (type-design analysis). Do these in one dedicated task at the
start of Plan 4, before the wrappers freeze the API:
- Reshape `WidgetContext` (snapshot fields, a `parsed()` accessor, a `commit` return value), and make `WidgetFactory`
  a descriptor.
- `UiMessages`: renames, plurals and a formatter.
- Adapter: an async `mount`, a `complete(offset, explicit)` signature, `CodeDiagnostic.code` and `source`, and async
  hover. Also `CodeDiagnostic.actions` (Plan 3): `CodeDiagnosticAction` is `{ label, apply() }` with no result and no
  stable id.
- `NodeView` and `CursorContext` as discriminated unions.
- `Problem.fix` (Plan 3): `QuickFix` and `QuickFixAction` are a closed union (`declareVariable` | `edit`); give them a
  stable id, and decide how `Problem` equality and `fix` interact when problems are compared across validations.
- Rename the controller type (`ManifestEditorController`), add `update(patch)` and `setFormat`.
- Decouple `ParsedText.docs` from `yaml`.
- The `Recipe.format` invariant, a typed `GuideField.widget` grammar, and a `Problem.code` template type.
- Move field-name knowledge into guide data (CR-S8): the `name` item labels, the ref-key sibling `name`, and the
  Secret/ConfigMap data keys.
- `TextRange`, `StoreEvent` and `ParsedText` fields are still mutable. Make them `readonly`, like `NodeRef` and `TextChange`.
- `renameKey` (and likely `add`) accept the key `<<`, which turns an ordinary key into a YAML merge key. Refuse `<<` as a new key name.
- Host widget `focus()` (reached through `focusField`) and `destroy()` (in the field row's `dropBody`) are unguarded. A throw there is not caught.
- In the editor's store subscriber, `applyFormat` → `recipes.refresh()` runs before `onChange`. A throw there is logged but skips `onChange`.
- R15(b) (Plan 3) extended the edit engine: `applyEdit` can `add` and `delete` a pair in a single-line flow map, by a
  minimal splice that keeps the flow style. Keep it.
- R18 (Plan 3): `VariableStore.set` and `remove` and `ManifestEditor.applyFix` return a boolean. Before release, change
  them to a result object that carries the refusal reason (read-only, name taken, invalid declaration, already
  declared, an edit refused and why).
- From the Plan 3 milestone review (type design and error handling), deferred:
  - `VariableDecl` as a discriminated union (`enumValues` only on `enum`); derive `VariableType` from a const tuple.
  - Export `checkDecl` (or a `validateVariableDecl`) so hosts can check a declaration before `setVariables`.
  - `setVariables` under the `x-variables` store only warns; decide whether it should throw.
  - Check that a `Rule.messages` table covers every key the rule uses (`rule.<id>` and its fix keys).
  - `registerFormat` does not deep-freeze the format, although its TSDoc says registered formats are deep-frozen.
  - TSDoc on `applyFix`: a fix applies to the current text, not to the text it was found in.
  - `applyEdit`'s catch-all maps any exception to `unsupported` silently (`edit.ts`, `applyEdit`); consider a
    `console.debug` so an engine bug is not mistaken for a refusal.
  - A type change in the Variables section drops a default that no longer fits (`fitted` in `variables-section.ts`)
    without saying so.

## Plan 4 (wrappers and release)
- **Changesets:** restore `.changeset/config.json` `fixed: [["@stack-weaver/core","@stack-weaver/angular","@stack-weaver/react"]]` when the wrappers are added. It is set to `[]` until then.
- **`@changesets/cli`:** kept at ^2.31.1 to match grid-master. Revisit ^3 there.

## Parked, low priority
- `--update-lock` and the first real schema bump: the lock-writing glue (`writeLockEntry`, the generators' flag branches) has only been tested with mocks. Expect to debug it on the first upstream bump.
- `parseText`'s dangling-alias check costs O(aliases × nodes).
- `add`/`push`/`delete` refuse on documents with more than 100 alias expansions. Those edits go to "edit in code".
- Deleting a pair whose value has comments between items is refused ("edit in code"), not restructured.
- Remaining per-task minors (kept in the SDD ledger at the time):
  - `edit.ts` size and helper split;
  - store re-entrancy semantics (a throwing listener is now logged and isolated);
  - generator rmSync and parallel-run race;
  - no-op int32/int64/double/byte formats;
  - lenient quantity regex;
  - entry-walk regex duplicated between `check-entry.mjs` and the test;
  - weak cycle assertion in `resolve.test.ts`;
  - a single resolve per property in `addableAt` (O(props × depth)).

## Plan 2 deferred minors
Each was found in a per-task review and judged not worth blocking the task. Grouped by area.

**Document model and edits (`document/`)**
- `edit.ts` is about 690 lines and a split candidate. `anchorsReferencedElsewhere` is unreachable (yaml scopes anchors per document), so it is an undocumented `alias` refusal: remove it or document it.
- Deleting document 0 when document 1 has no `---` (after `...`) is a false refusal.
- `describe.ts`: `keyText` is "[object Object]" for non-scalar keys, and the flow ancestor walk is O(depth^2).
- Test gaps: "set and delete return no `at`" only exercises `set`, and there is no `readOnly` test for a path under an alias.

**Formats, guide and engine**
- `freeze.ts`: the TSDoc says "deeply readonly" but it returns `T`, and the `isFrozen` early return skips shallow-frozen objects with unfrozen children.
- `mergeGuide`: a `__proto__` key sets the prototype, and an explicit `{ tier: undefined }` override erases the base tier.
- Guide tests: the frozen-bundle test checks only the root and `$defs`, and a few test and import-order nits.

**Code-mode assist and the CodeMirror adapter**
- `context.ts`: nested dashes (`- - x`) give the wrong path, consecutive `---` markers give a document index one too low, and a bare `-` prefix is read as a key prefix.
- `complete.ts` drops non-string enum members. The hover range includes the key's end.
- No end-to-end `cursorContext` test for an `accessModes` list-item completion.
- `completionSource` has no aborted check and an unhandled rejection of `complete()`; post-destroy calls are unguarded; `override: []` disables default completion (needs a comment).
- The theme tokens `--sw-selection` and `--sw-active-line` are optional and undocumented beyond the spec.
- Pack check should require the `.d.ts` files of the editors subpath, and the editors entry twin-regex skips type imports (confirm `verbatimModuleSyntax`).
- A code pane with mixed line endings (CRLF first, then LF lines) shows the LF part as merged CodeMirror lines: wrong line numbers and arrow movement. The bytes stay exact. The separator is taken from the first line break.
- A CRLF↔LF switch rebuilds the CodeMirror document, so lint markers disappear until the next validation publish, and fold or scroll state may reset.

**Editor shell, sync and problems**
- A pending-cleanup race after `clear()`; a validation wrapper that throws skips the publish; the sticky `auto` format is unpinned.
- `onProblems` calls `section.update` and bypasses the debounce. A problem click with no outline node does nothing.
- The `onProblemsChange`-after-destroy assertion is vacuous.
- The editor recipe test waits a fixed 250 ms per recipe (about 1.8 s), a mild flake and slowness risk.

**Visual pane and outline**
- An unknown CRD flashes as editable before its schema load resolves.
- Removing the last section hides the body, so `title.focus()` fails and focus falls to the body.
- The breadcrumb is not an `ol` and its label may duplicate; `null` and an empty string render alike.
- Selecting an outline node does not move the code pane's selection (only "Open", problem clicks and `reveal` do): decide whether it should.
- Lighthouse reports `label-content-name-mismatch` on outline tree items that have children: the accessible name is the label while the visible text includes the nested group. The scores are 100 in light and 99 in dark.

**Widgets**
- Clearing a number or quantity box commits nothing and leaves an empty box. "Add key" with an empty name gives no feedback.
- `createWidgetContext` defaults `isReadOnly` to the static `init.readOnly` (only `field-row` passes the live getter).
- The host-widget hooks `focus()` (reached from `focusField`'s `.then`, where a throw becomes an unhandled rejection) and `destroy()` in `dropBody()` are not guarded, unlike the factory and `update`. The editor-level pane guard has no test of its own (the field row catches a widget throw first).
- Composite `aria-label`s are baked at build; widgets use the global `document`; the scalar check and the `{label}` helper are duplicated; `current()` duplicates the lookup in the section code.
- References: `suggest*` ignore `metadata.namespace` (undocumented); `ref-key` hard-codes the sibling `name` (a guide param later); the datalist filters by the current value; `pickWidget` runs twice per field (row and slot).
- A mapping or list widget whose `update` throws falls back to an empty value span (the "Edit in code" note still shows). A card fallback would be clearer.

**Accessibility and styling**
- The real CodeMirror content's accessible name is not checked by the a11y test (it uses the fake adapter), and the live-region text change is not asserted.
- The focus-visible source scan is regex-based (best effort), and the breadcrumb spacing test is text-only.
- Control borders and decorative borders are now separate tokens (`--sw-control-border`, `--sw-border`). Only the picker panel still uses `--sw-border`; the dashed add slot uses `--sw-control-border` (R9). Revisit the picker if a design needs it stronger.

## Plan 3 deferred minors
Each was found in a per-task review and judged not worth blocking the task. Grouped by task.

**Task 1 (rule and variable hooks)**
- A `substitute()` throw is reported as `schema.unavailable`, which is misleading.
- No test for the missing `fix.key` fallback or a throwing rule message function.
- Type-only import cycle between `formats/types.ts` and `validation/problems.ts`.

**Task 2 (placeholder syntax and substitution)**
- `substituteData` loses an own `__proto__` key (`out[k] =`): use `Object.defineProperty` or a null-prototype object.
- `$$` stays `$$` in substituted text (compose unescapes it to `$`); this affects only `pattern` checks.
- Worst-case quadratic rescans on an unterminated `${X:-` (pathological input).
- The `OPS` array duplicates the `PlaceholderOp` union, and `defaultText`'s op is typed `string`.
- Missing tests: `${A:-$${B}}`, `${A:-}`, a boolean default as a string, a `__proto__` key.

**Task 3 (`x-variables` block)**
- `skippedPointer` hides an unknown-key typo whose value is a type-only placeholder (`pull_polcy: "${P}"`); the same trade-off as D1, with no dedicated test.
- `raw.default as string` is a misleading cast (`block.ts`).
- Test gaps: `description` set, `replaces` naming a missing entry, a non-mapping existing entry.
- `edit.ts` `dataAt` reads inherited properties on records (an out-of-scope observation).

**Task 4 (compose variable rules)**
- No tests for multi-document or sparse input, alias skipping, or `variable-type` with several or `:-` placeholders.
- `${A:-${B}}`: an undeclared `B` inside an inline default is never reported (`scanPlaceholders` returns the outer one only).
- `rules.ts` has a `def as string` cast, a hard-coded document 0 that needs a comment, and three walks per check (they could share the sites).
- CRLF: only plain, double-quoted and single-quoted scalars are tested for exact ranges (not block scalars or keys).

**Task 5 (Kubernetes rules)**
- `requests: null` and `limits: {}` count as present.
- `collect()` runs four times per validation.
- An unnamed container message reads `Container "0"`.
- `stringMap` turns `null` into `"null"`.
- Test gaps: a sparse leading document, Pod, Job and CronJob as Service targets, the StatefulSet, DaemonSet and ReplicaSet selector check.

**Task 6 (variable stores and `applyFix`)**
- An unknown `store` string from JS sets a bogus kind.
- `setAll` notifies and revalidates even when nothing changed.
- `applyFix(edit, ops: [])` returns true.
- Duplicate import in `context.ts`; import order in `editor.ts`.
- Format `'auto'` detection fires `onVariablesChange` (untested and undocumented).
- The `setVariables` D5 cases are partly untested.

**Task 7 (quick fixes in the UI)**
- No status announcement after a successful fix (WCAG 4.1.3); check the problem-count live region. A refused fix is announced.
- Identical Fix button texts are told apart only by `aria-describedby`.
- No UI test that applies the Kubernetes `missing-resources` fix (only its refusal on a flow container), or for the panel staying visible while problems remain.

**Task 8 (Variables section)**
- No test that an empty compose document shows the recipe cards and Variables together. Decide whether adding a variable on an empty document should dismiss the recipes (it does today, because the text is no longer empty).
- A port out of range shows the `invalidInteger` wording; `Number()` accepts `0x10` and `1e3`; a string default cannot be set to `''`.
- `pendingEnum` survives an external type change.

**Task 9 (use-variable toggle and union widgets)**
- Every toggle has the same accessible name, "Use variable": add `aria-describedby` to the row label.
- Variable completion is offered after a `$$` escape and inside block scalars.
- No test for the select disabled when read-only, or for focus on an undeclared reference after a variables change.
- The variable-binding error span is not cleared by a later successful update.

**Task 10 (docs, playground, release chain; flow-style entries)**
- `acceptsAll` re-parses text that `applyEdit` already parsed (about two extra parses per op on multi-op commits).
- A multi-op commit is one prefix/suffix splice of the old and new text: a code-pane caret or fold that sits between two
  far-apart ops can be remapped (the lines themselves stay byte-identical).
- Deviations accepted in review: `{}` is filled in only inside flow maps; single-line flow maps stay read-only in the
  visual tree; `renameKey` inside a flow map is still refused (`flow`); an enum change on a flow entry moves `enum:` last.
- Finding F2 (Plan 1/2 behaviour, not a regression): with `format: 'auto'` the format detected from the initial text stays
  locked; `setValue` of a compose document into a Kubernetes-detected editor validates it as Kubernetes.

**Milestone review residuals**
- The Variables section's `sw-variables-error` alert is cleared only by the next "Add variable" click, not by `update()`,
  so a refusal message can outlive its cause (same pattern as the variable-binding error span).
- The visual pane's `variablesSelected` flag is not reset when the Variables node goes away (e.g. a format change); if
  the node comes back, Variables is selected again instead of the current card.
- "Add variable" on an empty or comment-only document goes through `addDocument`, which writes a leading `---`; the
  README says it "starts the document with the `x-variables` block".
