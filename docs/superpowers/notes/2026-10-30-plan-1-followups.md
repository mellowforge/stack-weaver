# Plan 1 (headless core): carried-forward follow-ups

These are decisions and deferred work from the Plan 1 execution and its milestone review, which used the pr-review-toolkit panel. Later plans must pick them up.

> **Package names (2026-11-02):** `@stack-weaver/{core,react,angular}` below now means `@mellowforge/stack-weaver-{core,react,angular}`. The private workspace packages are `stack-weaver-demo-kit`, `stack-weaver-site` and `stack-weaver-angular-workspace`.

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

**Carried forward (Plan 2 had no consumer for these)** — all done in Plan 4
- **Full `yaml` decoupling.** Done (Plan 4 Tasks 2 and 3): `ParsedText` is opaque, `detect` / `loadSchema` take plain data, `toData` is the public read, `RuleInput.locate` ranges findings.
- **`DocumentStore`:** `reset(text)`, `clearHistory()` and `transact`. Done (Plan 4 Task 4).
- **`ResolvedSchema` aliasing:** done (Plan 4 Task 9): `JsonSchema` is readonly and `ResolvedSchema` does not alias bundle internals.
- **`EditResult`** returns the new `parsed`. Done (Plan 4 Task 2); the created node's ref (`at`) already existed.
- **Consider replacing `YamlProblem` with `Problem`.** Decided to keep both (P3): `YamlProblem` is the parse layer's, documented on both types (Plan 4 Task 2).

## Plan 4: API hardening before wrappers — status
All items below are done in Plan 4 unless marked moved.
- Reshape `WidgetContext` (snapshot fields, a `parsed()` accessor, a `commit` return value), and make `WidgetFactory`
  a descriptor. Done (Plan 4 Task 9: `WidgetDefinition`, `WidgetRef`; `parsed()` and the `commit` result already shipped).
- `UiMessages`: renames, plurals and a formatter. Done (Plan 4 Task 10).
- Adapter: an async `mount`, `CodeDiagnostic.code` and `source`, async hover, and `CodeDiagnosticAction` with a stable id.
  Done (Plan 4 Task 8). The `complete(offset, explicit)` signature already had `explicit`.
- `NodeView` and `CursorContext` as discriminated unions. Done (Plan 4 Task 9).
- `Problem.fix`: stable id and problem equality. Done (Plan 4 Task 5: `QuickFix.id`, `sameProblem`).
- Rename the controller type (`ManifestEditorController`), add `update(patch)` and `setFormat`. Done (Plan 4 Task 7).
- Decouple `ParsedText.docs` from `yaml`. Done (Plan 4 Tasks 2 and 3).
- The `Recipe.format` invariant (Plan 4 Task 7), a typed `GuideField.widget` grammar (Task 9), and a `Problem.code` template type (Task 5). Done.
- Move field-name knowledge into guide data (CR-S8). Done (Plan 4 Task 11: `labelKeys`, `resourceLabel`, `references`).
- `TextRange`, `StoreEvent` and `ParsedText` fields `readonly`. Done (Plan 4 Task 2).
- `renameKey` (and `add`) accept the key `<<`. Done (Plan 4 Task 4: refused as `unsupported`).
- Host widget `focus()` and `destroy()` guards. Done (Plan 4 Task 7).
- Store subscriber order (`applyFormat` → `recipes.refresh()` before `onChange`). Done (Plan 4 Task 7).
- R15(b): `applyEdit` adds and deletes a pair in a single-line flow map. Kept.
- R18: result objects instead of booleans. Done (Plan 4 Task 5: `ActionResult`).
- From the Plan 3 milestone review:
  - `VariableDecl` as a union, `VARIABLE_TYPES` const tuple. Done (Plan 4 Task 6).
  - `validateVariableDecl` exported. Done (Plan 4 Task 6).
  - `setVariables` under `x-variables` only warns. Kept per spec D5 (no change).
  - `Rule.messages` coverage check. Done (Plan 4 Task 6: a console warning, once per rule and key).
  - `registerFormat` freeze claim. Done (P13; TSDoc corrected in Plan 4 Task 3).
  - TSDoc on `applyFix`. Done (Plan 4 Task 5).
  - `applyEdit` catch-all `console.debug`. Done (Plan 4 Task 4); since the final review wave a look-alike `ParsedText`
    or malformed op is refused quietly and any other internal failure is a `console.error` (also in `canEdit`).
  - `fitted` announcement. Done (Plan 4 Task 6: `variableDefaultDropped`).
- Plan 3 milestone residuals: stale Variables alert (Plan 4 Task 6): partly done, the status region still is not
  cleared by `update()` on an external change (see Task 6 below). `variablesSelected` reset (Plan 4 Task 7) and the
  leading `---` on `addDocument` (Plan 4 Task 4): done. Finding F2 (`auto` format locked): done (Plan 4 Task 7, P8).
- Plan 4 milestone review (final wave): R8 (`getFormat()` returns the option, `getActiveFormat()`), R9 (type and API
  items), R11 (`PluralMessage.none`), R12 (undo/redo re-detect under `'auto'`), R13 (problem lists compare `path`), the
  picker follows the host guide, silent failures logged, `formatBadge`. Done.

## Plan 5 (wrappers and release): status
All items below are done in Plan 5 unless marked parked.
- **Changesets:** the fixed triple `["@stack-weaver/core","@stack-weaver/angular","@stack-weaver/react"]` is restored in `.changeset/config.json`. Done (Task 8). All three start at 0.0.0, and one `.changeset/first-release.md` makes the first release 0.1.0.
- **`@changesets/cli`:** kept at ^2.31.1 to match grid-master. Revisit ^3 there (with `changesets/action` v2).
- Wrappers recreate the editor when an init-only option changes (P8); only `value`, `mode`, `readOnly`, `theme`, `format` and the external variables are settable. Done (React and Angular).
- Wrappers pass only the props that changed to `update()` (R3). Done.
- The `check-types` unit test reads whatever `dist/` exists (and skips without a build); the CI gate is the release script and the `Core graph checks` CI step (`node scripts/check-types.mjs` after `build`). Done (Q12).
- `SyncCodeEditorAdapter`: done in the Plan 4 final wave.

### Plan 5 wrapper contract
All items are implemented in both wrappers, with matching test names.
- Init-only callbacks (`onChange`, `onProblemsChange`, `onModeChange`, `onVariablesChange`) are read once and routed through a trampoline. Done.
- Object options (`guide`, `widgets`, `formats`, `recipes`, `messages`, `variables`) are init-only and compared by reference; hosts are asked for stable objects. Done.
- `onChange` echo filtering: a pushed `value` or `mode` is not reported back. Done.
- Format binding with `getFormat()` / `setFormat()` (R8): the option round-trips, `onFormatChange` / `activeFormatChange` report the active format. Done.
- R10 controller signals (`onFormatChange`, `onHistoryChange`, `canUndo` / `canRedo`, `reset`, `clearHistory`). Done.
- R16: undo and redo re-detect the format only for steps made through the API. Done.
- `defaultWidgets` and `defaultUiMessages` are frozen. Done (Plan 5 Task 2).
- The Angular wrapper gained a `textChange` output (`{ value, origin }`) for parity with React's `onChange`. Done.
- S6: the `ActionRefusal` TSDoc says a multi-op refusal reports the first refused op's reason. Done (Plan 5 Task 2).
- S7: `recipes.choose` warns once per format when that format is not loaded, and still inserts the text. Done (Plan 5 Task 2;
  keyed by recipe id and format since the milestone review, S3).
- S5 (parked): map `ActionResult.edit` (`flow`, `alias`, `block-scalar`) to the "Edit in code" hint. The wrappers have no UI of their own, so there is nothing to map; the core editor already shows the hint.

### Plan 5 browser verification (Task 9)
Run with Chrome DevTools against `pnpm build:site` + `vite preview`:
- **Checked on the Vanilla, React and Angular tabs:**
  - a visual edit reaches the code pane, and typing in the code pane reaches the visual pane;
  - broken YAML shows the banner and "Jump to error";
  - Empty shows the recipes, and a recipe inserts YAML, fixes the format and moves focus to a field;
  - `x-variables` shows the Variables section and "Use variable";
  - the external variables example works;
  - the demo Undo and Redo buttons follow `historyChange`;
  - read-only blocks typing;
  - the status line updates;
  - the frameworks tabs create the iframes lazily, with titles;
  - no console errors.
- **Lighthouse accessibility:** 100 on the landing page, `react/` and `angular/`, in light and dark (6 runs).
- **Fixed during verification:**
  - the Angular demo page had no `<main>` landmark (it scored 99);
  - the React and Angular demos wrapped the wrapper's host in an extra `.demo-editor` box with no height, so the editor overflowed onto the status line. The wrapper host is now the box itself, and both wrapper READMEs say the editor fills its host's height.
- **Parked (core, found in the browser):**
  - Typing into the visual `apiVersion` field changes the kind after the first keystroke. The form then switches to "Unknown kind, edit in code" mid-typing, and the remaining keystrokes are lost. This was already the case in Plan 2. A possible fix: defer kind re-resolution while the field has focus, or commit `apiVersion` on change instead of on input.
    **Fixed** (branch `fix/apiversion-typing`): while a visual edit changes the kind of the section's document and focus is in the section, the visual pane holds the section; leaving the section renders again, and a non-visual change (code, undo, API) renders as usual, rebuilding a held section and refocusing its row. Every keystroke still reaches the code (spec Goal 1). Also seen then: the Angular demo page requests a missing `/favicon.ico` (404). **Done (0.1.1):** the React and Angular demo pages have the site icon.
  - Chrome reports the issue "No label associated with a form field" (count 6), although no unlabelled field is present and Lighthouse's label audits pass. The likely source is transient elements; worth a look.

### Plan 5 milestone review (panel fix wave)
The panel findings triaged IN landed in one fix wave (ruling P5-5: R1 is fixed in the wrappers, not in the core):
- Both wrappers: a recreation reports emptied problems (`[]`) and no active format (`undefined`) when the old editor
  had them (R1); the React reports run after the ref points at the new editor (R2); a pushed mode is not reported back
  in Angular either (R3); a push whose `update()` throws is not recorded as applied, so the next push retries it (S2);
  a failed Angular recreation leaves no controller, and the next input change retries it (S1); the recreation's
  history report is guarded in React and isolated by Angular's own output (S10). Done.
- Types: `HistoryState` is a core type export, used by `onHistoryChange` and both wrappers; both wrappers re-export the
  core types their API uses; Angular's `format` input has the core option type (T1, T2, T3). Done.
- Core: the recipe "format not loaded" warning is keyed by recipe and format (S3); TSDoc for `format` (R16 wording),
  `onFormatChange`, `reset`, `clearHistory` (no-ops after destroy) and the two detection policies (C1, C7, R4, R5, T7).
  Done.
- Tests: `formats` / `recipes` / `widgets` recreation and same-reference checks, unhandled-rejection listeners in the
  before-ready tests, store-kind recreation carries text and mode, and demo tests for the status after a recreation
  (X1, X3, X4, R1). Done.
- Docs and release: READMEs (C2, C5, C6, T4, T5), spec R12 note (C3), changeset wording (C8), CONTRIBUTING on the
  Version Packages PR (R6) and the `SHOW_NPM` repository variable (R7), the snippet's unused `origin` (R8), and
  `pack:check` compares the packed version with the source (S9). Done.

### Deferred from the Plan 4 final review (E)
- S4: the code pane's assist callbacks (completion, hover) have bare `catch` blocks; log with `console.debug`. Done (Plan 5 Task 2).
- S8: a widget whose `destroy()` throws after a `widgetFailed` note is logged a second time. Done (Plan 5 Task 2: a regression test pins one log per failure; the code already swallowed the destroy error).
- `defaultWidgets` (and `defaultUiMessages`) freeze. Done (Plan 5 Task 2).
- R10 controller signals. Done.
- R16: under `'auto'`, undo and redo re-detected on every history step, including typed ones. Done (Plan 5:
  the origin is recorded per history entry and only `'api'` steps re-detect).
- A host `detect` that throws under `'auto'` with no format re-detects, and logs, on every keystroke. Rate-limit it. Done (Plan 5 Task 2: logged when the message differs, cleared by a detect that does not throw).
- Test hygiene: `quick-fix.test.ts` still has local copies of the shared `focused()` helper (`visibleFocus`, `live`). Done (Plan 5 Task 2).
- The reserved rule id `'failed'` warning is deduped per page, not per format. Done (Plan 5 Task 2: keyed by format id).

## Parked, low priority
- **Wrappers: a recreation that throws behaves differently in each wrapper.**
  - Angular keeps no controller and retries the recreation on the next input change.
  - React lets the error reach the nearest error boundary, which unmounts the editor.
  - React leaves no choice here. **Done (0.1.1):** each wrapper README says so.
- Angular: a retry that still fails can be logged twice in one tick, when an init-only input and a settable input change together. The effect is bounded: no state corruption and no second editor.
- Core `resolveOption`: the outer catch still logs "the format detection threw", although it now catches failures to apply the format. **Done (0.1.1):** it logs "applying the format threw".
- Plan 5 review X2/X8: test-name symmetry between the wrappers (unmount vs destroy before ready, `onHistoryChange` vs
  `historyChange` drives undo buttons), and the React demo's missing counterparts of the Angular demo's "recreates the
  editor for another variables store" and "removes its DOM and editor on destroy".
- Plan 5 review X5: a controller-level test that undoing a `'visual'` step under `'auto'` does not re-detect.
- Plan 5 review X6: `reset()` tests: under `'auto'` with text of another format it calls `onFormatChange`; with a redo
  stack it reports `{ canUndo: false, canRedo: false }` once.
- Plan 5 review X7: the zone spec could assert that `textChange` / `historyChange` listeners run inside the Angular zone.
- Plan 5 review S5: format detection dedupes its log by the last message only.
- Plan 5 review S6: the code pane's `console.debug` for persistent hover and completion failures could warn once per message.
- Plan 5 review S8: the site's dist check does not assert that referenced assets are non-empty.
- Plan 5 review: `StoreEvent` as a discriminated union (`step` only on `'history'` events).
- Core `ready` never settles when the editor is destroyed while a mount never settles (a code editor whose `mount` promise stays pending): `destroy()` does not resolve it.
- `@changesets/cli` ^3 together with `changesets/action` v2 (grid-master is on ^2.31.1).
- Wrapper UIs: S5, the "Edit in code" hint mapping (see Plan 5 above).
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

## Plan 4 deferred minors
Each was found in a per-task review and judged not worth blocking the task. Grouped by task.

**Task 1 (check-types script)**
- A nested template literal inside `${}` ends the outer one early; import-like text inside a string literal can false-positive.
- `/// <reference types>` is not scanned; the baseline test skips when `dist/` is not built.

**Task 2 (opaque `ParsedText`)**
- The `check-types` unit test reads whatever `dist/` exists; the real gate is the release script after a build.

**Task 3 (formats see plain data)**
- `dataBundleKey` (merge-expanded) and the raw-tree `bundleKey` in `bundleFor` / the visual pane differ: a missed cache hit for `<<`-supplied `apiVersion` / `kind`. An undefined bundle is cached permanently per kind key (pre-existing).
- No direct picker test that `loadSchema` gets `{ apiVersion, kind }`.

**Task 4 (store and edit engine)**
- `transact`'s ok result lacks `at` for an empty or no-change call.
- No test for `renameKey` to `<<` on a flow key or a nested flow add, and no post-refusal grouping test.
- `console.debug` fires on hostile-input exceptions (plan-mandated). Superseded in the final wave: shape problems are
  refused quietly, internal failures are `console.error`.

**Task 5 (`ActionResult`, `sameProblem`)**
- The remove-refusal test asserts only the message (no `aria-invalid` or focus); `invalid` field-specific sub-messages are unreachable through the UI and untested.
- `sameProblem` ignores `fix.label` and `path` (P5, documented); no scheduler-level "fix-only change republishes" test; the `sameProblem` test does not assert the ignored fields.
- `unavailable` via `writeOps`-undefined or a format with no variables is untested; a dead `find` in the "ok results" test.

**Task 6 (variables)**
- The status region is not cleared by `update()` on an external change; `canAdd()` can clear an unrelated `editRefused` error.
- A sleep-based 150 ms test; a redundant ternary at `fit.ts:69`; blind `as VariableDecl` casts in `clean` / `fitted` / `block.ts`; a trivial alias in `declareFor`.
- `warnMissingKey` TSDoc should say the dedupe is per process. Done in the final wave (`warnOnce`: once per page).

**Task 7 (controller)**
- Interim re-detection against host-only formats while a lazy `'auto'` load is pending (flicker; the end state is right).
- An `'auto'` editor whose first built-in load fails while a pending `setFormat('mine')` succeeds: `ready` rejects but the editor works with no failure shown (spec-literal; decide resolve vs document in the `ready` TSDoc).
- After a failed first load under `'auto'`, a host-format re-detect leaves a stale `failureShown` / notice.

**Task 8 (adapter)**
- `fake-adapter.ts` indentation; import order in `codemirror/index.ts:15`.
- `SyncCodeEditorAdapter` (`@internal`) is used in `codemirrorAdapter()`'s public return type. Done in the final wave
  (public and exported).
- A rare race: the user types in an instance while an API change happens before an async mount arrives, and the API change is lost (now in the `CodeEditorAdapter.mount` TSDoc); unformatted long test lines (no prettier available).

**Task 9 (widgets and unions)**
- A near-tautological "host registry entry replaces" test in `widgets.test.ts`.
- Redundant `?? []` / `?? 0` after narrowing (`outline-model.ts:66,73`, `section.ts:168`).
- A plain-JS host bare function gives an opaque "widget failed" note; `JsonSchema` readonly is shallow; the README
  `managesKeys` paragraph was a long line. All three done in the final wave (README note on bare functions, TSDoc
  "shallowly read-only", paragraph rewrapped).

**Task 10 (messages)**
- An unreachable `new Intl.PluralRules()` (runtime-default locale) branch at `format-message.ts:31`.
- Default schema messages (`validation/messages.ts:47`, "Must be a ... or ...") are English built into `MessageFn`s: host-overridable per keyword, out of `UiMessages` scope.
- The README messages section listed `{name}` templates by hand and missed keys: since the final wave it says
  "templates with `{…}` placeholders", points to `defaultUiMessages` for every key, and lists this release's new keys.
- Remove-button names `${ctx.label} ${name}` use a fixed " " joiner; `defaultUiMessages` is not frozen (consistent with `defaultMessages`).

**Task 11 (guide data)**
- The `WidgetContext.guide()` breaking change was documented only in the report (now in the changeset).
- Ruling R6: the `'kind'` key stays a literal in visual and assist code (the `documents` root model's discriminator); a host `documents` format with another discriminator would need a `Guide.kindKey`.
