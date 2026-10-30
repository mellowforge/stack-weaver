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
  - store listener exceptions and re-entrancy semantics;
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
- Deleting document 0 when document 1 has no `---` (after `...`) is a false refusal, and deleting document 0 drops a comment on the next `---` line.
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

**Editor shell, sync and problems**
- `ready` rejects unhandled if the host does not await it (blank code pane, no message), and it never resolves if the first schema load never settles (note it in the TSDoc).
- A pending-cleanup race after `clear()`; a pane update that throws skips `onChange`; a validation wrapper that throws skips the publish; the sticky `auto` format is unpinned.
- `onProblems` calls `section.update` and bypasses the debounce. A problem click with no outline node does nothing.
- The `onProblemsChange`-after-destroy assertion is vacuous.

**Visual pane and outline**
- An unknown CRD flashes as editable before its schema load resolves.
- Removing the last section hides the body, so `title.focus()` fails and focus falls to the body. No test for destroy while the picker is open.
- The breadcrumb is not an `ol` and its label may duplicate; `null` and an empty string render alike; `Entry.level` is unused.
- Selecting an outline node does not move the code pane's selection (only "Open", problem clicks and `reveal` do): decide whether it should.
- Lighthouse reports `label-content-name-mismatch` on outline tree items that have children: the accessible name is the label while the visible text includes the nested group. The scores are 100 in light and 99 in dark.

**Widgets**
- Clearing a number or quantity box commits nothing and leaves an empty box. A renamed key moves to the end of the map. "Add key" with an empty name gives no feedback.
- `createWidgetContext` defaults `isReadOnly` to the static `init.readOnly` (only `field-row` passes the live getter), and the rename rollback ignores its own failure.
- Composite `aria-label`s are baked at build; widgets use the global `document`; the scalar check and the `{label}` helper are duplicated; `current()` duplicates the lookup in the section code.
- References: `suggest*` ignore `metadata.namespace` (undocumented); `ref-key` hard-codes the sibling `name` (a guide param later); the datalist filters by the current value; `pickWidget` runs twice per field (row and slot).

**Accessibility and styling**
- The real CodeMirror content's accessible name is not checked by the a11y test (it uses the fake adapter), and the live-region text change is not asserted.
- The focus-visible source scan is regex-based (best effort), and the breadcrumb spacing test is text-only.
- Control borders and decorative borders are now separate tokens (`--sw-control-border`, `--sw-border`). Dashed slots and the picker still use `--sw-border`; revisit if a design needs them stronger.
