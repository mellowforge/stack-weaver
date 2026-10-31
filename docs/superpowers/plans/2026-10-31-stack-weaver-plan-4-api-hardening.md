# stack-weaver Plan 4: API Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the public API of `@stack-weaver/core` before Plan 5 wraps it in React and Angular: remove `yaml` types
from the public surface, give every refusal a reason, make the controller updatable, and fix the remaining type and
message design debts.

**Architecture:**
- **Scope:** `packages/core` only. Plan 5 (wrappers, `demo-kit`, `site/`, release) builds on the API this plan freezes.
- **Source of the work list:** the "Plan 4: API hardening before wrappers" and "Carried forward" sections of
  `docs/superpowers/notes/2026-10-30-plan-1-followups.md`, corrected for staleness (see "Already done").
- **Breaking changes are allowed** (the package is unreleased 0.x). Every break is listed in the changeset.

**Tech Stack:** TypeScript ^7.0.2, `yaml` v2, ajv (precompiled), CodeMirror 6, Vitest ^5.0.5 + happy-dom ^21.0.4,
pnpm 12.11.2, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-30-stack-weaver-design.md` — "Host API", "Code mode", "Formats as data",
"Compose variables" and "Decisions from the builder check". Plans 1–3 are merged on `main`.

## Global Constraints

- **Plans 1–3 still apply:**
  - edits never reformat untouched lines; CRLF and indentation are preserved; offsets are UTF-16;
  - every public export has TSDoc;
  - validating 1,000 lines takes under 50 ms (rules included);
  - never set `innerHTML` with document, guide, recipe or host strings;
  - classes are `sw-*` and custom properties `--sw-*`; WCAG 2.2 AA; one undo history (the store's);
  - UI strings go in `UiMessages` with defaults in `defaultUiMessages`.
- **Entry graph:** `node scripts/check-entry.mjs` (in `packages/core`) passes after every task.
- **Public type graph (new, Task 1):** no `.d.ts` file reachable from `dist/index.d.ts` imports from `yaml`.
  `node scripts/check-types.mjs` passes from Task 2 on.
- **Exports pin:** `test/index.test.ts` pins the runtime export list. Every task that adds, renames or removes an
  export updates it in the same commit.
- **No new runtime dependencies.** `Intl.PluralRules` is the only new platform API.
- **Spec values that stay verbatim:** the Host API option names; `variables?: { store: 'x-variables' } | { store:
  'external'; value }`; D5 (`setVariables` under `x-variables` warns and does nothing); the `--sw-*` tokens.
- **Changeset:** each breaking change gets one line under "Breaking" in `.changeset/api-hardening.md` (Task 12
  writes the file; tasks append their line to a running list in their report).

## Already done (the follow-ups note is stale here — do not redo)
- `WidgetContext` already has a `parsed()` accessor, readonly snapshot fields and `commit()` returning
  `EditRefusal | undefined`.
- `TextRange`, `Position`, `NodeRef`, `TextChange`, `YamlProblem`, `Problem`, `EditResult` are readonly.
- `ResolvedSchema` may alias bundle internals safely: bundle schemas are deep-frozen (`formats/validator.ts:29`).
  Task 9 only types `JsonSchema` nodes as readonly.
- `CodeEditorInit.complete(text, offset, explicit)` already takes `explicit` and may return a promise.

## Decisions (rulings made while planning; each is the plan's authority)

- **P1. `yaml` leaves the public types.** `ParsedText` becomes an opaque handle with readonly public fields
  `text, ok, docCount, errors, warnings, eol`. The yaml documents and line counter move behind a module-private
  symbol, read only through internal helpers (`yamlDocs(p)`, `lineCounterOf(p)`). `getNode` becomes internal
  (`describeNode` is the public read view). *Cost if wrong:* host formats that walk yaml nodes must use `toData` /
  `describeNode` instead.
- **P2. Formats see plain data.** `FormatDefinition.detect(input: DetectInput)` with
  `DetectInput = { readonly docs: readonly unknown[] }` (each entry is `toData` of that document, `undefined` when
  empty or unbuildable); `loadSchema(data: unknown)` takes one document's data. `RuleInput.parsed` stays (opaque)
  and gains `locate(doc, path, at?) => TextRange | undefined` so third-party rules can range findings without yaml.
  Built-in compose rules keep their internal yaml walk for placeholder ranges. `FormatVariables` keeps `ParsedText`
  parameters (opaque; built-ins use internal helpers).
- **P3. `YamlProblem` stays.** It is the parse layer's problem (no severity, source or path); `Problem` is the
  validated, editor-facing one. TSDoc on both says so.
- **P4. One result type for refusable editor actions.**
  ```ts
  type ActionRefusal = 'no-fix' | 'read-only' | 'destroyed' | 'unavailable' | 'invalid' | 'name-taken'
    | 'not-found' | 'already-declared' | 'edit-refused';
  type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: ActionRefusal; readonly edit?: EditRefusal };
  ```
  `VariableStore.set`, `VariableStore.remove` and the controller's `applyFix` (`ManifestEditor.applyFix` until Task 7
  renames the type) return it.
  `unavailable` = no variables for this format, or the text does not parse. `edit` is set when `reason` is
  `edit-refused`.
- **P5. Fix identity and problem equality.** `QuickFix.id` is the rule's fix key (`fix.declare-variable`,
  `fix.add-resources`). A new public `sameProblem(a, b)` compares severity, code, message, doc, from, to, `fix.id`
  and the fix action; the scheduler and the field rows use it (one signature, not three). Fixes apply to the
  current text (ops address nodes by path), stated in `applyFix` TSDoc.
- **P6. `Problem.code` is a template-literal type** `ProblemCode`:
  `` `yaml.${'syntax' | 'warning' | 'data'}` | `schema.${string}` | `kind.${'unknown' | 'apiVersion'}` |
  'format.extraDocument' | `rule.${string}` ``.
- **P7. `VariableDecl` is a discriminated union** over `VARIABLE_TYPES = ['string','number','boolean','port','enum']
  as const`; `enumValues` exists only on the enum member and is required there; `default` is typed per member
  (`string` / `number` / `boolean` / `number` / `string`). `validateVariableDecl(value: unknown):
  VariableDeclIssue | undefined` is exported (the internal `checkDecl` becomes it). Issue names stay camelCase
  (`badName`, …) because rule message keys use them.
- **P8. Controller.** The type is renamed `ManifestEditorController` (no alias). It gains
  `update(patch: ManifestEditorUpdate)`, `getFormat()` and `setFormat(format)`. Settable at runtime: `value`, `mode`,
  `readOnly`, `theme`, `format`, and the external variable list. Everything else stays init-only (wrappers recreate
  the editor when an init-only option changes — Plan 5). Under `format: 'auto'`, an `'api'` text change
  (`setValue`, `update({ value })`, `reset`) re-detects the format; typing does not (fixes finding F2).
- **P9. Adapter.** `mount` may return the instance or a promise of it. `hover` may return a promise.
  `CodeDiagnostic` gains `code: ProblemCode` and `source: ProblemSource`; `CodeDiagnosticAction` gains `id`
  (the `QuickFix.id`).
- **P10. Widgets.** `WidgetRegistry` maps names to `WidgetDefinition { create(ctx): WidgetInstance;
  managesKeys?: boolean }`. `GuideField.widget` becomes `WidgetRef { name: string; param?: string }`.
- **P11. Messages.** `UiMessages` is readonly. Count messages are `PluralMessage` (`{ zero?, one?, two?, few?,
  many?, other }`) chosen with `Intl.PluralRules(locale)`; `EditorMessages.locale` (default `'en'`) sets the
  locale. Every message with a value uses `{param}` templates rendered by the exported `formatMessage`; no UI text
  is built by concatenation. `formatMessage` replaces every occurrence, never re-expands text that came from a
  parameter, and leaves an unknown `{x}` as written.
- **P12. Field-name knowledge moves into guide data** (`Guide.labelKeys`, `GuideKind`/`Guide.resourceLabel`,
  `Guide.references`) — exact shapes in Task 11.
- **P13. Formats are not frozen by `registerFormat`.** Freezing would mutate the host's object. The
  `FormatDefinition` TSDoc claim is corrected; built-ins stay frozen.

## Review Focus

1. **A host format written without `yaml`:** a format whose `detect`, `loadSchema` and one rule use only the public
   API (plain data, `locate`) detects, validates and ranges its finding. Test in Task 3.
2. **Controlled value churn:** `update({ value })` with the current text is a no-op (no `onChange`, no history);
   a compose text pushed into a Kubernetes-detected `'auto'` editor switches format; the caret survives a minimal
   diff. Tests in Task 7.
3. **Async mount races:** the editor is destroyed before an async `mount` resolves → the instance is destroyed and
   nothing leaks; `mount` rejects → `ready` rejects and the failure is shown. Tests in Task 8.
4. **Plurals beyond English:** with `locale: 'ru'` and a host table (`one/few/many/other`), counts 1, 3, 5 and 21
   pick the right forms; 0 uses `zero` when given. Tests in Task 10.
5. **Message parameters that look like templates:** a variable named `{name}` or a label containing `{count}` is
   inserted literally, and a template using the same parameter twice fills both. Tests in Task 10.

---

### Task 1: Public type graph check

**Files:**
- Create: `packages/core/scripts/check-types.mjs`
- Modify: `package.json` (root): the `release` script runs it after `check-entry.mjs`.
- Test: `packages/core/test/scripts/check-types.test.ts`

**Interfaces:**
- Produces: `node scripts/check-types.mjs [--list]` — follows relative `import`/`export … from` specifiers from
  `dist/index.d.ts` through `.d.ts` files; exits 1 and prints each reached file that imports from `yaml`
  (`--list` prints them and exits 0). Export a `reachedYamlImports(entryPath): string[]` function for the test.

- [ ] **Step 1: Write the failing tests** with a temporary fixture tree of `.d.ts` files:
  ```ts
  it('follows export-from and import type specifiers transitively', …)
  it('reports a reached file that imports from yaml, and not an unreached one', …)
  it('handles cycles', …)
  it('today, dist reaches yaml imports (baseline for Task 2)', …)  // build first; expect a non-empty list
  ```
- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/scripts/check-types.test.ts`. FAIL.
- [ ] **Step 3: Implement** with plain regex scanning of specifiers (like `check-entry.mjs`); no TypeScript API.
- [ ] **Step 4: Run** the test. PASS. Record the current list of offending files in your report (Task 2's target).
- [ ] **Step 5: Commit**: `build(core): public type graph check for yaml imports`.

---

### Task 2: Opaque `ParsedText` and readonly document types

**Files:**
- Modify: `src/document/types.ts` (public `ParsedText`), `src/document/parse.ts`, `src/document/paths.ts`,
  `src/document/data.ts`, `src/document/edit.ts`, `src/document/describe.ts`, `src/document/render.ts`,
  `src/document/store.ts` (`StoreEvent`, `StoreOptions` readonly), and every `.docs` / `.lineCounter` reader
  (≈45 sites in ≈20 files, listed by `grep -rn "\.docs\b\|lineCounter" src`).
- Create: `src/document/internal.ts` — the yaml-typed internals.
- Modify: `src/index.ts` (drop `getNode`), `test/index.test.ts`.
- Test: `test/document/parse.test.ts`, `test/scripts/check-types.test.ts` (flip the baseline test to expect `[]`).

**Interfaces:**
- Produces (public):
  ```ts
  export interface ParsedText {
    readonly text: string; readonly ok: boolean; readonly docCount: number;
    readonly errors: readonly YamlProblem[]; readonly warnings: readonly YamlProblem[]; readonly eol: '\n' | '\r\n';
  }
  ```
  `EditResult`'s ok variant gains `readonly parsed: ParsedText` (the re-parse `applyEdit` already does);
  `DocumentStore` uses it instead of parsing twice.
- Produces (internal, `src/document/internal.ts`): `yamlDocs(p: ParsedText): readonly Document.Parsed[]`,
  `lineCounterOf(p: ParsedText): LineCounter`, `getNode(p, ref): Node | undefined` (moved from `paths.ts`). The
  fields live under a module-private `Symbol` set by `parseText`; a `ParsedText` not made by `parseText` throws
  `TypeError('stack-weaver: not a ParsedText from parseText')` in these helpers.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('parseText exposes text, ok, docCount, errors, warnings and eol only', …)  // Object.keys(p) sorted equals
  it('docCount counts documents, including empty ones between separators', …)  // '---\n---\na: 1\n' → 3
  it('the yaml internals are not enumerable and not string-keyed', …)
  it('internal helpers reject an object literal posing as ParsedText', …)
  it('applyEdit returns the new parsed text on success', …)
  it('no d.ts reachable from dist/index.d.ts imports yaml', …)  // check-types baseline → []
  ```
- [ ] **Step 2: Run** the parse, edit and check-types tests. FAIL.
- [ ] **Step 3: Implement.** Replace `p.docs.length` with `p.docCount` where only the count is needed. Move every
  yaml-typed export the public `.d.ts` graph would reach into `internal.ts` (or another internal module index never
  re-exports from). Keep behaviour identical.
- [ ] **Step 4: Run** the full suite, `pnpm typecheck`, build, `check-entry`, `check-types`. PASS.
- [ ] **Step 5: Commit**: `refactor(core)!: opaque ParsedText; yaml types leave the public API`.

---

### Task 3: Formats and rules on plain data

**Files:**
- Modify: `src/formats/types.ts` (`FormatDefinition.detect/loadSchema`, `DetectInput`, `RuleInput.locate`,
  `FormatDefinition` TSDoc freeze claim — P13), `src/formats/registry.ts` (`detectFormat`),
  `src/formats/kubernetes/index.ts`, `src/formats/compose/index.ts`, `src/formats/kubernetes/rules.ts` (use
  `locate`/data, no yaml), `src/editor/formats.ts`, `src/editor/context.ts`, `src/editor/problems.ts`,
  `src/visual/picker.ts` (no synthetic parse), `src/validation/validate.ts`.
- Test: `test/formats/detect.test.ts`, `test/formats/registry.test.ts`, `test/formats/host-format.test.ts` (new),
  loader tests, `test/visual/picker.test.ts`.

**Interfaces:**
- Consumes: Task 2's `yamlDocs`, `toData`.
- Produces:
  ```ts
  export interface DetectInput { readonly docs: readonly unknown[] }
  // FormatDefinition:
  detect(input: DetectInput): boolean;
  loadSchema(data: unknown): Promise<SchemaBundle | undefined>;
  // RuleInput gains:
  locate(doc: number, path: YamlPath, at?: 'key' | 'value'): TextRange | undefined;  // nearest existing ancestor
  ```
  `detectFormat(p: ParsedText, formats?)` keeps its signature and builds the `DetectInput` once.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  // host-format.test.ts — Review Focus 1
  it('a format written with the public API only detects, validates and ranges a rule finding', …)
    // detect: input.docs.some(d => isRecord(d) && 'pipeline' in d); loadSchema: returns an inline bundle;
    // a rule uses input.data + input.locate(0, ['pipeline','steps',0]) → problem range equals the slice of that node
  it('detect receives undefined for an empty or unbuildable document', …)
  it('loadSchema receives the document data', …)  // kubernetes: { apiVersion: 'apps/v1', kind: 'Deployment' }
  it('locate maps a missing path to the nearest existing ancestor', …)
  it('kubernetes/rules.ts does not import yaml', …)  // read the source file, assert no "from 'yaml'"
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.** The picker calls `format.loadSchema({ apiVersion, kind })`. The compose rules keep their
  internal yaml walk (they use `src/document/internal.ts`).
- [ ] **Step 4: Run** the full suite, typecheck, build, `check-entry`, `check-types`. PASS.
- [ ] **Step 5: Commit**: `refactor(core)!: formats detect and load schemas from plain data`.

---

### Task 4: Store transactions and edit-engine guards

**Files:**
- Modify: `src/document/store.ts`, `src/document/edit.ts`, `src/editor/variables.ts` (use `transact`).
- Test: `test/document/store.test.ts`, `test/document/edit.test.ts`, `test/editor/variables.test.ts`.

**Interfaces:**
- Produces (`DocumentStore`):
  ```ts
  transact(ops: readonly EditOp[], opts?: { readonly group?: string }): EditResult;  // all or nothing, one event, one undo step
  reset(text: string): void;   // replaces the text (origin 'api'), clears history, emits one event
  clearHistory(): void;
  ```
  A one-op `transact` behaves exactly like `edit` (same grouping). A multi-op `transact` dry-runs every op and commits
  the final text as one minimal splice (what `variables.ts` `applyOps` does today, moved here).
- Edit engine:
  - `add` and `renameKey` with key `<<` are refused with `'unsupported'`.
  - `applyEdit`'s catch-all logs `console.debug('stack-weaver: applyEdit failed', err)` before refusing.
  - `addDocument` on a text with zero documents writes no `---` separator (Plan 3 residual: "Add variable" on an
    empty document).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('transact commits all ops as one undo step and one event', …)
  it('transact refuses atomically and leaves text, history and listeners untouched', …)
  it('transact with one op merges with a same-group edit like edit() does', …)
  it('reset replaces the text, empties undo and redo, and emits origin api', …)
  it('clearHistory empties undo and redo without changing the text', …)
  it("add and renameKey refuse the key '<<'", …)
  it('an engine exception is logged with console.debug and refused as unsupported', …)  // spy; force via a poisoned op
  it("addDocument on '' and on '# hi\\n' writes no separator", …)  // '# hi\nx: 1\n'
  it('VariableStore multi-op set still commits once (now through transact)', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement**; delete the private `dryRun`/`applyOps` duplicate in `variables.ts`.
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `feat(core): DocumentStore transact, reset and clearHistory; edit guards`.

---

### Task 5: Results, fix identity and problem equality

**Files:**
- Modify: `src/validation/problems.ts` (`ProblemCode`, `sameProblem`), `src/formats/types.ts` (`QuickFix.id`),
  `src/validation/validate.ts`, `src/editor/variables.ts` (`ActionResult`), `src/editor/editor.ts`,
  `src/editor/context.ts`, `src/editor/problems.ts`, `src/editor/problems-panel.ts`, `src/editor/code-pane.ts`,
  `src/visual/widgets/field-row.ts`, `src/visual/variables-section.ts`, `src/visual/widgets/variable-binding.ts`,
  `src/index.ts`, `test/index.test.ts`.
- Test: `test/validation/problems.test.ts` (new), `test/editor/variables.test.ts`, `test/editor/quick-fix.test.ts`,
  `test/visual/variables-section.test.ts`.

**Interfaces:**
- Produces: `ProblemCode` (P6), `Problem.code: ProblemCode`, `QuickFix.id: string` (P5),
  `sameProblem(a: Problem, b: Problem): boolean`, `ActionRefusal`, `ActionResult` (P4).
- UI mapping of refusals: `name-taken` → `ui.variableNameTaken`; `invalid` → the field's own validation message;
  everything else → `ui.editRefused`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('sameProblem is true for equal problems from two validations and false when only the fix action differs', …)
  it('the scheduler publishes when only a fix changes (uses sameProblem)', …)
  it('QuickFix.id is the rule fix key', …)  // 'fix.declare-variable', 'fix.add-resources'
  it.each([
    ['read-only', …], ['destroyed', …], ['unavailable', …], ['invalid', …], ['name-taken', …],
    ['not-found', …], ['already-declared', …], ['no-fix', …], ['edit-refused', …],
  ])('set/remove/applyFix report %s', …)   // edit-refused carries edit: 'flow' for a multi-line flow entry
  it('ok results are { ok: true }', …)
  it("ProblemCode rejects 'foo' at compile time", …)  // // @ts-expect-error in a typed test
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement**, replacing the three ad-hoc signatures with `sameProblem`.
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `feat(core)!: action results with reasons, fix ids, sameProblem`.

---

### Task 6: Variable declarations and rule hygiene

**Files:**
- Modify: `src/formats/types.ts` (P7 union), `src/variables/decl.ts` (`validateVariableDecl`, `VARIABLE_TYPES`),
  `src/formats/compose/variables/block.ts`, `src/formats/compose/variables/rules.ts`, `src/variables/fit.ts`,
  `src/editor/variables.ts`, `src/visual/variables-section.ts`, `src/visual/widgets/variable-binding.ts`,
  `src/visual/visual-pane.ts`, `src/validation/validate.ts`, `src/editor/messages.ts`, `src/index.ts`,
  `test/index.test.ts`.
- Test: `test/variables/decl.test.ts` (new), `test/validation/rules.test.ts`, `test/visual/variables-section.test.ts`,
  `test/visual/visual-pane.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export const VARIABLE_TYPES: readonly ['string', 'number', 'boolean', 'port', 'enum'];
  export type VariableType = (typeof VARIABLE_TYPES)[number];
  export type VariableDecl = StringVariable | NumberVariable | BooleanVariable | PortVariable | EnumVariable; // P7
  export type VariableDeclIssue = 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField';
  export function validateVariableDecl(value: unknown): VariableDeclIssue | undefined;
  ```
- New UiMessages key `variableDefaultDropped`: `The default {value} does not fit the new type and was removed.`

**Also in this task (rule hygiene and Plan 3 residuals):**
- `runRule`: the first time a rule's finding uses a message key or fix key missing from the merged table,
  `console.warn('stack-weaver: rule "<id>" has no message for "<key>"')` once per rule and key.
- The Variables section announces `variableDefaultDropped` in its polite status region when a type change drops a
  default.
- The section's `sw-variables-error` alert is cleared by `update()` when its cause is gone (text parses again, the
  block becomes a mapping, read-only ends).
- `visual-pane.ts` resets `variablesSelected` when the Variables node disappears.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('validateVariableDecl accepts each valid member and names the issue of each invalid one', …)
  it('validateVariableDecl rejects non-objects and unknown fields', …)  // 5, null, { name:'A', type:'string', x:1 }
  it("enumValues on a non-enum is a type error", …)  // // @ts-expect-error
  it('a missing rule message key warns once and still yields a problem', …)
  it('a type change that drops a default announces it', …)
  it('the add-variable error clears once the block is a mapping again', …)
  it('after a format change the Variables selection does not come back', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.** Remove the `as string` / `as readonly string[]` casts the union makes unnecessary.
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `feat(core)!: VariableDecl union, validateVariableDecl, rule message checks`.

---

### Task 7: The controller

**Files:**
- Modify: `src/editor/editor.ts`, `src/editor/formats.ts`, `src/editor/recipes.ts`, `src/visual/widgets/field-row.ts`,
  `src/visual/section.ts`, `src/index.ts`, `test/index.test.ts`, and the tests that name the type.
- Test: `test/editor/controller.test.ts` (new), `test/editor/failures.test.ts`, `test/editor/recipes.test.ts`.

**Interfaces:**
- Consumes: `DocumentStore.reset` (Task 4), `ActionResult` (Task 5).
- Produces:
  ```ts
  export interface ManifestEditorController { /* every ManifestEditor member, plus: */
    update(patch: ManifestEditorUpdate): void;
    getFormat(): string | undefined;               // the resolved format id
    setFormat(format: ManifestEditorOptions['format']): void;   // 'auto' re-detects now
  }
  export interface ManifestEditorUpdate {
    readonly value?: string; readonly mode?: EditorMode; readonly readOnly?: boolean; readonly theme?: EditorTheme;
    readonly format?: ManifestEditorOptions['format']; readonly variables?: readonly VariableDecl[];  // external store only
  }
  ```
  `update` applies fields in the order format, value, variables, readOnly, mode, theme; each behaves like its
  setter (no-op when current). `createManifestEditor` returns `ManifestEditorController`.

**Also in this task:**
- P8 re-detection on `'api'` text changes under `'auto'`.
- The store subscriber wraps `applyFormat`, `recipes.refresh()` and `refreshHistory()` in `guarded(…)`, so a throw
  there no longer skips `onChange` and `variables.check()`.
- Host widget `focus()` (`field-row.ts` `focusRow`) and `destroy()` (`dropBody`, the `section.ts` row loops) are
  guarded like `update()`: a throw is logged and the row shows `ui.widgetFailed`; the remaining rows are still
  destroyed.
- `Recipe.format` invariant: a recipe whose `format` names no known format is dropped with one `console.warn`; a
  test asserts every built-in recipe detects as its own format.

- [ ] **Step 1: Write the failing tests** — Review Focus 2 and the rest:
  ```ts
  it('update({ value }) with the current text fires nothing and adds no history', …)
  it('update({ value }) with a compose text switches an auto editor from kubernetes to compose', …)
  it('typing compose text into an auto kubernetes editor does not switch', …)
  it('update applies several fields at once in the documented order', …)
  it('setFormat fixes the format; setFormat("auto") re-detects', …)
  it('a minimal-diff update keeps the code caret', …)
  it('a throwing recipes.refresh still lets onChange fire', …)
  it('a widget whose focus() throws is logged and does not break navigation', …)
  it('a widget whose destroy() throws does not stop the other rows being destroyed', …)
  it('a host recipe for an unknown format is dropped with a warning', …)
  it('every built-in recipe detects as its own format', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.** `formatOption` becomes mutable state; `setValue` and `update({ value })` share one path.
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `feat(core)!: ManifestEditorController with update and setFormat`.

---

### Task 8: Code editor adapter

**Files:**
- Modify: `src/editors/adapter.ts`, `src/editors/codemirror/index.ts`, `src/editors/codemirror/hover.ts`,
  `src/editor/code-pane.ts`, `test/helpers/fake-adapter.ts` (add an `async` option), `test/editors/adapter-contract.ts`.
- Test: `test/editors/codemirror.test.ts`, `test/editors/fake-adapter.test.ts`, `test/editor/code-pane.test.ts`
  (new or existing), and the ≈19 files using the fake adapter where they read `adapter.last` before `ready`.

**Interfaces:**
- Produces (P9):
  ```ts
  mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance | Promise<CodeEditorInstance>;
  hover?(text: string, offset: number): HoverInfo | undefined | Promise<HoverInfo | undefined>;
  interface CodeDiagnostic { …; readonly code: ProblemCode; readonly source: ProblemSource }
  interface CodeDiagnosticAction { readonly id: string; readonly label: string; apply(): void }
  ```
  `ready` resolves after an async mount resolves; a rejected mount rejects `ready` and shows the existing code-pane
  failure message.

- [ ] **Step 1: Write the failing tests** — Review Focus 3 and the contract:
  ```ts
  it('an async mount resolves before ready', …)
  it('destroy before an async mount resolves destroys the instance when it arrives', …)
  it('a rejected mount rejects ready and shows the failure', …)
  it('diagnostics carry code and source; actions carry the fix id', …)  // contract suite, both adapters
  it('an async hover result is shown by CodeMirror', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.** `code-pane.ts` awaits `Promise.resolve(adapter.mount(...))`.
- [ ] **Step 4: Run** the full suite, typecheck, build, `check-entry`. PASS.
- [ ] **Step 5: Commit**: `feat(core)!: async adapter mount and hover; diagnostic code, source and action id`.

---

### Task 9: Widgets and read views

**Files:**
- Modify: `src/visual/widgets/types.ts`, `src/visual/widgets/registry.ts`, every factory (`text.ts`, `choice.ts`,
  `collections.ts`, `reference.ts`, `secret.ts`), `src/visual/widgets/field-row.ts`, `src/visual/add-slot.ts`,
  `src/visual/outline-model.ts`, `src/formats/types.ts` (`GuideField.widget`, readonly `JsonSchema`),
  `src/formats/guide.ts` (`mergeGuide`), `src/formats/kubernetes/guide.ts`, `src/document/describe.ts`
  (`NodeView` union), `src/assist/context.ts` (`CursorContext` union) and their readers, `src/index.ts`,
  `test/index.test.ts`.
- Test: `test/visual/widgets.test.ts`, `test/formats/guides.test.ts`, `test/document/describe.test.ts`,
  `test/assist/context.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type WidgetFactory = (ctx: WidgetContext) => WidgetInstance;
  export interface WidgetDefinition { readonly create: WidgetFactory; readonly managesKeys?: boolean }
  export type WidgetRegistry = Readonly<Record<string, WidgetDefinition>>;
  export interface WidgetRef { readonly name: string; readonly param?: string }   // GuideField.widget
  export type NodeView = MapView | SeqView | ScalarView | AliasView;   // discriminated by `type`
  export type CursorContext = KeyCursor | ValueCursor;                  // discriminated by `position`; `key` only on ValueCursor
  export type JsonSchema = Readonly<Record<string, unknown>>;
  ```
  `pickWidget` returns `{ name, param? }` from a `WidgetRef` (no string parsing).

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('a host registry entry { create } replaces a built-in widget', …)
  it('managesKeys comes from the definition', …)  // secret-data
  it('GuideField.widget { name: "ref", param: "Secret" } picks the ref widget with param Secret', …)
  it('NodeView narrows: value only on scalar, keys only on map, length only on seq', …)  // typed + runtime
  it('CursorContext has key only for a value position', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `refactor(core)!: widget definitions, WidgetRef, NodeView and CursorContext unions`.

---

### Task 10: UI messages — formatter, plurals, locale

**Files:**
- Create: `src/editor/format-message.ts`.
- Modify: `src/editor/messages.ts` (readonly `UiMessages`, `PluralMessage`, templates), `src/editor/editor.ts`
  (`EditorMessages.locale`), every `ui.` consumer that concatenates or `.replace`s (the 8 sites in the survey plus
  the "Item N" / "Document N" labels), `src/index.ts`, `test/index.test.ts`, `README.md` (messages table).
- Test: `test/editor/format-message.test.ts` (new), `test/editor/problems.test.ts`, `test/visual/outline-model.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  export type PluralMessage = { readonly other: string } & Readonly<Partial<Record<'zero' | Intl.LDMLPluralRule, string>>>;
  export function formatMessage(template: string, params?: Readonly<Record<string, string | number>>): string;
  export function formatPlural(message: PluralMessage, count: number, locale?: string, params?: …): string;
  // UiMessages: problemsNone/problemsOne/problemsMany → problemCount: PluralMessage
  //   ({ zero: 'No problems', one: '{count} problem', other: '{count} problems' });
  //   item labels → itemLabel: 'Item {n}', documentLabel: 'Document {n}'; all keys readonly.
  // EditorMessages gains readonly locale?: string  (default 'en').
  ```
  `zero` is used for a count of 0 when present; otherwise the CLDR category decides.

- [ ] **Step 1: Write the failing tests** — Review Focus 4 and 5:
  ```ts
  it('formatMessage fills every occurrence of a parameter', …)  // 'Remove {label} ({label})'
  it('formatMessage inserts parameter text literally (no re-expansion)', …)  // name '{name}' → '{name}'
  it('formatMessage leaves unknown placeholders as written', …)
  it.each([[1,'one'],[3,'few'],[5,'many'],[21,'one']])('ru: %i picks %s', …)  // host table
  it('zero is used for 0 when given', …)
  it('the problem count text follows locale and host plural table', …)
  it('no ui message is concatenated: item and document labels come from templates', …)
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement**, converting every concatenation and `.replace` site.
- [ ] **Step 4: Run** the full suite (a11y and css tests included) and typecheck. PASS.
- [ ] **Step 5: Commit**: `feat(core)!: message formatter, plural messages and locale`.

---

### Task 11: Field-name knowledge into guide data

**Files:**
- Modify: `src/formats/types.ts` (`Guide`), `src/formats/guide.ts` (`mergeGuide`), `src/formats/kubernetes/guide.ts`,
  `src/formats/compose/guide.ts`, `src/visual/outline-model.ts`, `src/visual/widgets/field-row.ts`,
  `src/assist/hover.ts`, `src/visual/suggest.ts`, `src/visual/widgets/reference.ts`.
- Test: `test/visual/outline-model.test.ts`, `test/visual/reference.test.ts`, `test/assist/hover.test.ts`,
  `test/formats/guide.test.ts`.

**Interfaces:**
- Produces (on `Guide`, all optional, merged by `mergeGuide`):
  ```ts
  readonly labelKeys?: readonly string[];        // keys whose string value labels a sequence item; default []
  readonly resourceLabel?: YamlPath;             // path whose string value labels a document; default none
  readonly references?: Readonly<Record<string, { readonly nameKey: string; readonly dataKeys: readonly string[] }>>;
  ```
  Kubernetes guide: `labelKeys: ['name']`, `resourceLabel: ['metadata', 'name']`, `references: { Secret: { nameKey:
  'name', dataKeys: ['data', 'stringData'] }, ConfigMap: { nameKey: 'name', dataKeys: ['data', 'stringData',
  'binaryData'] } }`. Compose guide: `labelKeys: []`. No `'name'`, `'metadata'`, `'Secret'`, `'ConfigMap'`, `'data'`
  literals remain in `visual/` or `assist/` outside guide data.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('a host guide override labelKeys: ["id"] labels items by id', …)
  it('a compose sequence of mappings with a name key is labelled "Item N" (compose has no labelKeys)', …)
  it('references drive the ref-key suggestions (a host kind with its own dataKeys)', …)
  it('resourceLabel drives the outline and hover breadcrumb', …)
  it('visual/ and assist/ sources contain none of the field-name literals', …)  // read sources, assert
  ```
- [ ] **Step 2: Run** them. FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and typecheck. PASS.
- [ ] **Step 5: Commit**: `refactor(core): field-name knowledge moves into guide data`.

---

### Task 12: Docs, changeset and verification

**Files:**
- Modify: `packages/core/README.md` (controller, `update`, `setFormat`, results, adapters, widgets, messages,
  formats-as-data), `docs/superpowers/specs/2026-10-30-stack-weaver-design.md` (Host API block; record P1–P13 under
  "Decisions from the builder check"), `docs/superpowers/notes/2026-10-30-plan-1-followups.md` (mark the Plan 4 list
  done item by item; anything deferred is moved to a "Plan 5" or "Parked" line with a reason),
  `packages/core/examples/playground.ts` (uses `ManifestEditorController`, `update`, `setFormat`).
- Create: `.changeset/api-hardening.md` (`@stack-weaver/core` minor; "Breaking" list collected from the task
  reports; additive list).

**Steps:**
- [ ] **Step 1: Release chain.** `pnpm build && pnpm test && pnpm typecheck && (cd packages/core && node
  scripts/check-entry.mjs && node scripts/check-types.mjs) && pnpm pack:check`. All exit 0. Record test count and
  entry size in the ledger.
- [ ] **Step 2: Browser smoke** with chrome-devtools against `pnpm --filter @stack-weaver/core dev`: both formats
  load; the format select switches through `setFormat`; a quick fix and a refused fix show their messages; the
  problem count reads "No problems" / "1 problem" / "N problems". Lighthouse accessibility 100 in light and dark.
- [ ] **Step 3: Fix** anything Step 2 finds, with a test for each. Re-run Step 1.
- [ ] **Step 4: Commit**: `docs: API hardening (README, spec, follow-ups, changeset)`.

---

## Coverage of the follow-ups list

| Item | Task |
| --- | --- |
| Full `yaml` decoupling; `ParsedText.docs`; `detect`/`loadSchema`; `toData` exposure | 2, 3 |
| `TextRange`/`StoreEvent`/`ParsedText` readonly | 2 |
| `DocumentStore` reset, clearHistory, transact | 4 |
| `EditResult` returns the new parsed text (the created ref already exists) | 2 |
| `YamlProblem` vs `Problem` | P3 (kept, documented in 2) |
| `<<` as a new key; `applyEdit` catch-all | 4 |
| R18 result objects; `applyFix` TSDoc | 5 |
| `Problem.fix` id and equality; `Problem.code` template type | 5 |
| `VariableDecl` union, const tuple, exported validator; `Rule.messages` check; `fitted` announcement | 6 |
| `setVariables` under `x-variables` | kept per spec D5 |
| `registerFormat` freeze claim | P13 (TSDoc fixed in 3) |
| Controller rename, `update`, `setFormat`; subscriber order; widget `focus`/`destroy` guards; `Recipe.format` | 7 |
| Adapter async mount/hover, diagnostic code/source, action id | 8 |
| `WidgetFactory` descriptor; `GuideField.widget` grammar; `NodeView`/`CursorContext` unions; `ResolvedSchema` | 9 |
| `UiMessages` renames, plurals, formatter | 10 |
| Field-name knowledge into guide data (CR-S8) | 11 |
| Plan 3 residuals (stale alert, `variablesSelected`, leading `---`) | 6, 4 |
| Finding F2 (`auto` format locked) | 7 (P8) |
