# stack-weaver Plan 2: Editor UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `@stack-weaver/core` into a working editor. `createManifestEditor(el, options)` renders Visual, Code and Split modes over the Plan 1 document model, with:
- a CodeMirror 6 adapter;
- schema completion and hover;
- live validation;
- an outline;
- schema-driven widgets;
- the "add here" slot and the Add resource picker;
- starter recipes;
- `--sw-*` theming.

**Architecture:**
- **One `DocumentStore` is the hub.** The code pane writes to it synchronously on every change. The visual pane writes structural edits through `store.edit`. Each pane redraws from store events: the code pane immediately, as a minimal splice; the visual pane 100 ms after a code change, or immediately after any other change.
- **The DOM is hand-written,** with no framework, like dash-builder.
- **The code editor sits behind a public `CodeEditorAdapter` interface.** The CodeMirror adapter and the built-in formats are reached only through dynamic `import()`, so the core entry stays small.
- **Everything the UI shows comes from data**: schema, guide and recipes. There is no per-field UI code.

**Tech Stack:** what Plan 1 set up (pnpm 12.11.2, Node 22, TypeScript ^7.0.2, Vitest ^5.0.5, `yaml` ^2.9.1, `ajv` ^8.20.0, **Changesets ^2.31.1**; Plan 1's header said ^3.0.3, but the repo has ^2.31.1 on purpose, so keep it), plus:
- `happy-dom` ^21.0.4 (dev);
- `vite` ^8.3.5 (dev, for the playground only);
- CodeMirror: `@codemirror/state` ^6.7.6, `@codemirror/view` ^6.43.15, `@codemirror/commands` ^6.11.1, `@codemirror/autocomplete` ^6.20.4, `@codemirror/lint` ^6.9.7, `@codemirror/language` ^6.13.1, `@codemirror/lang-yaml` ^6.1.3.

**Spec:** `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`. This is plan 2 of 4; Plan 1, the headless core, is merged. Carried-forward items: `docs/superpowers/notes/2026-10-30-plan-1-followups.md`.

**Layout authority:** the Figma wireframes at https://www.figma.com/design/ed7dBRPBVrj8TDsSqcvQ79:
- frame 1, Visual: outline, add-here slot and grouped picker;
- frame 2, Split;
- frame 2b, Split with invalid YAML;
- frame 3, Code: completion and the problems panel.

Visuals within that direction are the implementer's call. The wireframe badge's "Kubernetes 1.34" is outdated; the badge shows `format.label` + `format.version`.

**Midpoint:** after Task 6, code mode, the host API and recipes work end to end. Tasks 7–12 add visual mode.

## Global Constraints

- **Plan 1 still applies:** edits never reformat untouched lines; CRLF and indentation are preserved; offsets are UTF-16; every public export has TSDoc; validation of 1,000 lines takes under 50 ms.
- **Entry graph:** the static import graph of `dist/index.js` must not reach any of the following: `generated/`, `formats/kubernetes/`, `formats/compose/`, `editors/`, or any bare `@codemirror/*` specifier.
  - The editor reaches the built-in formats and the CodeMirror adapter **only through dynamic `import()`**.
  - `scripts/check-entry.mjs` enforces this. Task 4 extends it.
- **Package `exports`:** add `"./editors/codemirror"` (`{types, import}`) and `"./stack-weaver.css"`.
  - `sideEffects` becomes `["*.css"]`.
  - The CodeMirror packages are **`peerDependencies`** (not optional), duplicated as `devDependencies`.
- **Tests:** vitest stays `environment: 'node'`. DOM test files start with `// @vitest-environment happy-dom`, following grid-master's pattern.
- **Safe rendering:** never set `innerHTML` with document, guide, recipe or host-supplied strings. Use `textContent` and attributes.
- **CSS naming:** every class is `sw-*` and every custom property is `--sw-*`. Both are public API.
  - The theme is set by `data-sw-theme="light" | "dark"` on the editor root.
  - `theme: 'auto'` (the default) follows `prefers-color-scheme`.
- **Accessibility:** WCAG 2.2 AA, using these APG patterns:
  - **Tree View** for the outline;
  - **Dialog (Modal)** for the picker;
  - **Radio Group** for the mode switch.

  Every input has an accessible name, and focus is always visible.
- **Sync timing [call]:**
  - The code pane calls `store.setText(text, 'code')` synchronously on every document change, so `onChange` fires synchronously.
  - The visual pane re-renders **100 ms** after the last `'code'` change, and immediately after `'visual'`, `'api'` and `'history'` changes.
  - Validation runs **150 ms** after the last change. Results computed for an older text are dropped.
- **One undo history** (the store's):
  - CodeMirror's `history()` is never installed.
  - Mod-z goes to `store.undo()`, and Mod-Shift-z and Mod-y go to `store.redo()`. This applies in both panes, including inside visual text inputs.
- **Visual typing:** each keystroke in a visual text widget is one `store.edit` call. Consecutive edits that share a `group` key within `groupMs` form one undo step. The group key is `visual:<doc>:<path joined by "/">`.
- **No wizard and no per-field code:**
  - The widget for a field comes only from guide `widget`, then schema shape.
  - Special behaviour (Secret base64, reference pickers) is selected by guide `widget` names, never by checking field names in code.
- **Messages:**
  - UI strings live in `UiMessages`, with defaults in `defaultUiMessages`.
  - The host option is `messages?: { ui?: Partial<UiMessages>; schema?: Partial<SchemaMessages> }`.
  - Each task adds the keys it needs to `defaultUiMessages`.
- **Out of scope here:**
  - Compose variables, the Variables section and semantic rules belong to Plan 3. Plan 2 renders `x-*` keys like any other key.
  - Wrappers, `site/`, Lighthouse and publishing belong to Plan 4.
  - Monaco is out.

## Review Focus

1. **Visual edit while the code text is broken:** the visual pane shows `lastGood` read-only, with the banner. Widgets are disabled, and nothing is written against `lastGood`. Pinned by Task 7 test `visual is read-only while parse is broken`.
2. **Undo across panes:** Mod-z pressed in the code pane after a visual edit undoes that visual edit, and both panes show the restored text. Pinned by Task 9 test `Mod-z in code undoes a visual edit`.
3. **External `setValue` while the user works in code:** the adapter gets one minimal splice, not a full replace, so a caret outside the changed range stays where it was. Pinned by Task 5 test `setValue applies a minimal splice` and Task 4 contract test `applyChange keeps a selection outside the change`.
4. **`destroy()` during a pending schema load:** once the load resolves, nothing touches the DOM, and no callback fires. Pinned by Task 5 test `no callbacks after destroy`.
5. **An unknown CRD first in a multi-document file:** the following known documents stay fully editable in visual. Pinned by Task 7 test `unknown kind does not block later documents`.

---

### Task 1: Document API hardening

**Files:**
- Modify: `packages/core/src/document/edit.ts`, `store.ts`, `data.ts`, `types.ts`, `packages/core/src/index.ts`
- Create: `packages/core/src/document/describe.ts`
- Test: `packages/core/test/document/edit.test.ts`, `store.test.ts`, `describe.test.ts`, `data.test.ts`

**Interfaces:**
- Consumes: Plan 1's `applyEdit`, `canEdit`, `getNode`, `getPairKey`, `toData(doc)`, `isEmptyDocument`.
- Produces:
  - `type TextRange = { readonly from: number; readonly to: number }`.
  - `EditOp` gains `| { op: 'deleteDocument'; doc: number }`.
  - `EditResult` ok branch becomes `{ ok: true; text: string; change: TextChange; at?: NodeRef }`. `at` is the created node for `add` (`[...path, key]`), `push` (`[...path, index]`) and `addDocument` (`{ doc: <new index>, path: [] }`).
  - `DocumentStore.edit(op: EditOp, opts?: { group?: string }): EditResult`. Consecutive `'visual'` edits with the same `group` within `groupMs` merge into one undo step. Edits without a group never merge.
  - `toData(p: ParsedText, doc: number): unknown` replaces `toData(doc: Document.Parsed)`, and `isEmptyDocument(p: ParsedText, doc: number): boolean` gets the same change. Update every internal caller.
  - `describeNode(p: ParsedText, ref: NodeRef): NodeView | undefined`, where:
    ```ts
    interface NodeView {
      readonly ref: NodeRef;
      readonly type: 'map' | 'seq' | 'scalar' | 'alias';
      readonly range: TextRange;          // the value node's source range
      readonly keyRange?: TextRange;      // when the node is a map pair's value
      readonly value?: ScalarValue;       // scalars only
      readonly keys?: readonly string[];  // maps: keys in source order, as strings
      readonly length?: number;           // sequences
      readonly flow: boolean;             // a flow collection, or inside one
      readonly anchor?: string;           // the node's own anchor name
      readonly readOnly?: EditRefusal;    // canEdit(p, ref)
    }
    ```

- [ ] **Step 1: Write failing tests:**
  - `edit.test.ts`:
    - `deleteDocument removes the document and its marker`: deleting doc 1 of `a: 1\n---\nb: 2\n---\nc: 3\n` gives `a: 1\n---\nc: 3\n`, and deleting doc 0 gives `b: 2\n---\nc: 3\n`.
    - `deleteDocument keeps comments of other documents`.
    - `deleteDocument of the only document leaves an empty text`.
    - `deleteDocument refuses an out-of-range doc with not-found`.
    - `add returns at`, `push returns at` and `addDocument returns at`.
  - `store.test.ts`:
    - `visual edits with the same group merge`: two `set` edits with group `g` 100 ms apart make one undo step.
    - `different groups do not merge`.
    - `ungrouped visual edits never merge`.
  - `describe.test.ts`: map keys in source order, numeric key `8080` as `"8080"`, scalar value, sequence length, `flow: true` inside `{ a: 1 }`, an anchor name, `readOnly: 'alias'` under an alias, `undefined` for a missing path, and `keyRange` covering the key text.
  - `data.test.ts`: `toData(p, 0)` equals Plan 1's results, including merge-key expansion.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test`. Expected: FAIL, because the ops and functions are missing.
- [ ] **Step 3: Implement `deleteDocument`.** It removes the document's text range plus the `---` marker that separates it from its neighbour:
  - when the document is not the first, the marker that precedes it;
  - when it is the first, the marker that follows it.

  The splice must re-parse to `docs.length - 1` documents, otherwise the edit returns `unsupported`. Implement `describeNode` over `getNode`/`getPairKey`/`canEdit`. Add the store's `group` merge beside its existing `'code'` merge.
- [ ] **Step 4:** Run the full core suite and `pnpm --filter @stack-weaver/core typecheck`. Expected: PASS. All 366 Plan 1 tests still pass, with updated call sites.
- [ ] **Step 5:** Commit `feat(core): deleteDocument, created refs, grouped visual edits, describeNode`.

### Task 2: Public type and guide hardening

**Files:**
- Modify:
  - `packages/core/src/formats/types.ts`, `guide.ts`, `validator.ts`, `registry.ts`;
  - `kubernetes/index.ts`, `kubernetes/guide.ts`, `compose/index.ts`, `compose/guide.ts`;
  - `packages/core/src/engine/addable.ts`, `catalog.ts`;
  - `packages/core/src/validation/problems.ts`, `packages/core/src/index.ts`.
- Test: the matching files under `packages/core/test/formats/`, `test/engine/`, plus `test/index.test.ts`.

**Interfaces:**
- Produces:
  - `GuideField.tier?: Tier`, which replaces `recommended`/`advanced`. With no entry, or no `tier`, the field is `'advanced'`; an entry without `tier` but with other keys is `'common'` (Plan 1 semantics, re-expressed).
  - `Tier` moves to `formats/types.ts`; `engine/addable.ts` re-exports it.
  - Named types:
    - `GuideGroup { id; label; order }`;
    - `GuideKind { label; description; group; order? }`;
    - `KindCatalog { curated: readonly CatalogGroup[]; all: readonly KindEntry[] }`, the return type of `kindCatalog`;
    - `Position { line; col }`, the return type of `toLineCol`;
    - `ProblemSource = 'yaml' | 'schema' | 'rule'`.
  - `GuideOverride { groups?: readonly GuideGroup[]; kinds?: Readonly<Record<string, Partial<GuideKind>>>; fields?: Readonly<Record<string, Partial<GuideField>>> }`.
  - `mergeGuide(base: Guide, override: GuideOverride): Guide`. It deep-merges per entry and **drops** kind entries that, after merging, lack `label`, `description` or `group`.
  - `kindKey(apiVersion: string, kind: string): string`, returning `` `${apiVersion}/${kind}` ``. It is the one key used by the guide `kinds` and `kindCatalog`.
  - `valueTemplateAt(bundle: SchemaBundle, guide: Guide, path: YamlPath): YamlValue`: Plan 1's private `template()`, exported. It uses the guide `example` first, then an empty value by schema type.
  - Every field of the public interfaces in `formats/types.ts`, `engine/*.ts` and `validation/problems.ts` is `readonly`.
  - `kubernetesFormat`, `composeFormat` and both guides are deep-frozen.
  - `wrapValidator` deep-freezes `bundle.schema`, so `ResolvedSchema` can safely alias it.
  - **Subpaths trimmed:**
    - `@stack-weaver/core/formats/kubernetes` exports only `kubernetesFormat`;
    - `…/formats/compose` exports only `composeFormat`.

    `loadKubernetesKind`, `kubernetesKinds`, `kubernetesGuide`, `loadComposeSchema` and `composeGuide` stay internal.

- [ ] **Step 1: Write failing tests:**
  - `tier drives addable ranking`: re-express Plan 1's ranking tests with `tier`.
  - `mergeGuide drops incomplete kinds`: an override adding `'x/v1/Foo': { label: 'Foo' }` with no group yields no `x/v1/Foo`.
  - `mergeGuide overrides one field key`.
  - `kindKey matches catalog keys`: every `kindCatalog(kubernetesFormat).curated` kind satisfies `kindKey(k.apiVersion, k.kind) in kubernetesGuide.kinds`.
  - `formats and guides are frozen`: `Object.isFrozen` on the format, guide, `guide.fields` and a field entry.
  - `bundle schema is frozen`.
  - `valueTemplateAt` for `Container#resources`, which gives `{}`, and for a guide `example`.
  - `subpaths export only the format`: `Object.keys(await import('../../src/formats/kubernetes/index.js'))` deep-equals `['kubernetesFormat']`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Convert the curated guide data (`recommended: true` becomes `tier: 'recommended'`). Update `addable.ts` to read `tier`. Export the new names from `src/index.ts`. Keep `ParsedText.docs` typed as `yaml`'s `Document.Parsed`, documented as an advanced escape hatch.

  **Ruling:** full `yaml` decoupling of `FormatDefinition.detect`/`loadSchema` is deferred. `describeNode` and `toData(p, doc)` cover the UI's needs.
- [ ] **Step 4:** Run the core tests and typecheck. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core)!: guide tiers, GuideOverride, kindKey, readonly public types, trimmed subpaths`.

### Task 3: Code-mode assist engine (DOM-free)

**Files:**
- Create: `packages/core/src/assist/context.ts`, `complete.ts`, `hover.ts`
- Test: `packages/core/test/assist/context.test.ts`, `complete.test.ts`, `hover.test.ts`

**Interfaces:**
- Consumes: `resolveAt`, `addableAt`, `valueTemplateAt`, `guideField`, `refAtOffset`, `toData`, `KindEntry`, `Tier`.
- Produces:
  ```ts
  interface CursorContext {
    readonly doc: number;
    readonly path: YamlPath;              // the map or sequence item that the cursor adds to
    readonly position: 'key' | 'value';
    readonly key?: string;                // position 'value': the key whose value is being typed
    readonly prefix: string;              // partial word before the cursor
    readonly from: number;                // start offset of `prefix`
    readonly indent: number;              // column new child keys start at
  }
  function cursorContext(text: string, offset: number): CursorContext | undefined;

  interface CodeCompletion {
    readonly label: string; readonly apply: string; readonly detail?: string;
    readonly info?: string; readonly section?: { readonly name: string; readonly rank: number };
    readonly boost?: number;
  }
  interface CompletionInput {
    readonly ctx: CursorContext; readonly eol: '\n' | '\r\n';
    readonly bundle: SchemaBundle | undefined; readonly guide: Guide;
    readonly data: unknown;                 // the document's data from the latest good parse (toData)
    readonly kinds: readonly KindEntry[];   // the format's kinds ([] for compose)
    readonly tierLabels: Readonly<Record<Tier, string>>;
  }
  function completionsFor(input: CompletionInput): readonly CodeCompletion[];

  interface HoverInfo { readonly from: number; readonly to: number; readonly title: string; readonly description: string; readonly required: boolean }
  function hoverAt(p: ParsedText, offset: number, bundle: SchemaBundle | undefined, guide: Guide): HoverInfo | undefined;
  function breadcrumbAt(p: ParsedText, offset: number): readonly string[];  // ['Deployment web', 'spec', 'template', …]
  ```

- [ ] **Step 1: Write failing `context.test.ts`:**
  - `key at nested map`: cursor after `    rep` under `spec:` gives `{path: ['spec'], position: 'key', prefix: 'rep', indent: 2}`.
  - `blank line uses cursor column`.
  - `sequence item index`: the third `- name:` item under `containers:` gives path `[…, 'containers', 2]`.
  - `non-indented sequence`: `- ` at the parent key's column.
  - `value position`: `  imagePullPolicy: If` gives `{position: 'value', key: 'imagePullPolicy', prefix: 'If'}`.
  - `doc index counts --- markers`, which is 1 after one separator. A leading `---` before the first content does not count.
  - `inside block scalar returns undefined`.
  - `inside flow collection returns undefined`.
  - `comment line returns undefined`.
  - `CRLF text` gives the same results as LF.
- [ ] **Step 2: Write failing `complete.test.ts`:**
  - `offers missing container fields with tiers`: `resources` is in the section of rank 0, which is `'recommended'`, and existing keys are excluded.
  - `apply inserts key and colon`: a scalar gives `"image: "`. An object gives `"resources:" + eol + " ".repeat(indent + 2)`. An array of objects gives `"ports:" + eol + " ".repeat(indent) + "- "`. The array case uses the parent's indentation, so non-indented style is the default **[call]**.
  - `required fields get boost 10 and detail 'required'`.
  - `enum value completion` (`imagePullPolicy` gives `Always`, `IfNotPresent`, `Never`).
  - `boolean value completion`.
  - `kind value at a document root lists kinds`, and `apiVersion value narrows to the kind already typed`.
  - `no bundle gives only kind/apiVersion at root, else []`.
- [ ] **Step 3: Write failing `hover.test.ts`:**
  - `hover over a key gives the guide label and first-sentence description`.
  - `hover over the required key marks required`.
  - `breadcrumb for a container image`: gives `['Deployment web', 'spec', 'template', 'spec', 'containers', '0', 'image']`. Its first element is `` `${kind} ${metadata.name}` ``, or `kind` alone, or `Document <n+1>`.
- [ ] **Step 4: Implement `cursorContext` as an indentation walk.** The text may not parse while the user is typing, so it does not use the parse:
  1. **Document index:** count `---` marker lines (`/^---(\s|$)/`) above the cursor line. Do not count a marker that comes before any content line.
  2. **Cursor line:** classify the text before the cursor.
     - It is a **key** position if it matches `^(\s*)((?:-\s+)*)([\w.\-/]*)$`. The key column is the length of groups 1 and 2.
     - It is a **value** position if it matches `^(\s*)((?:-\s+)*)([^\s:#'"][^:#]*?):\s+([^\s#]*)$`.
     - Each `- ` in group 2 opens a sequence item.
     - Return `undefined` if the cursor is inside a block scalar or a flow collection, or the line is a comment.
     - **Block scalar:** a previous ancestor line ends with `|` or `>` (plus indicators), and the cursor's column is deeper.
     - **Flow collection:** unbalanced `{` or `[` on the ancestor chain.
  3. **Ancestors:** walk upward over non-blank, non-comment lines, keeping a target column (the key column at the start).
     - **Map parent:** a line whose content column is less than the target and whose content is `key:` with nothing after it except a comment. Push `key` and set the target to its column.
     - **Sequence item:** a line whose content after one or more `- ` sits at the target column marks the start of the current item. Count the earlier `- ` lines at the same dash column, up to the parent, to get the index. Push the index, then continue with the target set to the dash column.
     - **Non-indented sequences:** a `key:` line at the dash column with no dash is the parent.
     - Stop at the document start.
  4. **Value position:** the context path is the key's parent path, and `key` is set.

  Then implement `completionsFor` over `addableAt`, `resolveAt` and `valueTemplateAt`, and `hoverAt` and `breadcrumbAt` over `refAtOffset` and `resolveAt`.
- [ ] **Step 5:** Run the assist tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(core): code-mode assist engine (cursor context, completion, hover, breadcrumb)`.

### Task 4: `CodeEditorAdapter` and the CodeMirror 6 adapter

**Files:**
- Create:
  - `packages/core/src/editors/adapter.ts`, the public interface, exported from `src/index.ts` as types only;
  - `packages/core/src/editors/codemirror/index.ts`;
  - `packages/core/test/helpers/fake-adapter.ts`;
  - `packages/core/test/editors/adapter-contract.ts`, a shared suite and not a test file;
  - `packages/core/test/editors/codemirror.test.ts`, `fake-adapter.test.ts`.
- Modify:
  - `packages/core/package.json` (devDeps, peerDeps, the exports entry);
  - `packages/core/scripts/check-entry.mjs` and its test in `test/index.test.ts`;
  - `scripts/pack-check.mjs` (required `dist/editors/codemirror/index.js`).

**Interfaces:**
- Produces, in `editors/adapter.ts` (public):
  ```ts
  interface CodeDiagnostic { readonly from: number; readonly to: number; readonly severity: Severity; readonly message: string }
  interface CodeCompletionResult { readonly from: number; readonly options: readonly CodeCompletion[] }
  interface CodeEditorInit {
    readonly text: string; readonly readOnly: boolean; readonly theme: 'light' | 'dark'; readonly ariaLabel: string;
    onChange(text: string): void;                 // user edits only, never for applyChange
    onUndo(): void; onRedo(): void;
    onSelectionChange?(range: TextRange): void;
    complete?(text: string, offset: number, explicit: boolean): CodeCompletionResult | null | Promise<CodeCompletionResult | null>;
    hover?(text: string, offset: number): HoverInfo | undefined;
  }
  interface CodeEditorInstance {
    getText(): string;
    applyChange(change: TextChange): void;        // external splice, must not call onChange
    setDiagnostics(d: readonly CodeDiagnostic[]): void;
    reveal(range: TextRange, opts?: { select?: boolean }): void;
    getSelection(): TextRange;
    setReadOnly(readOnly: boolean): void;
    setTheme(theme: 'light' | 'dark'): void;
    focus(): void;
    destroy(): void;
  }
  interface CodeEditorAdapter { mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance }
  ```
- From `@stack-weaver/core/editors/codemirror`: `codemirrorAdapter(opts?: { extensions?: Extension[] }): CodeEditorAdapter`.
- Internal: `const External = Annotation.define<boolean>()` tags `applyChange` transactions, and the update listener ignores them. There is no `history()`. The keymap is `Mod-z` to `onUndo`, and `Mod-Shift-z` and `Mod-y` to `onRedo`, placed before `defaultKeymap`.
  - **Read-only and theme:** one `Compartment` each.
  - **Diagnostics:** `setDiagnostics` from `@codemirror/lint`.
  - **Completion:** `autocompletion({ override: [source] })`. The source maps `CodeCompletion` to CodeMirror's `Completion` (`apply`, `detail`, `info`, `section`, `boost`) and returns `{from, options, validFor: /^[\w.\-/]*$/}`.
  - **Hover:** `hoverTooltip` renders `title` and `description` with `textContent`.
  - **Language:** `yaml()` from `@codemirror/lang-yaml`.
- `test/helpers/fake-adapter.ts`: `createFakeAdapter(): CodeEditorAdapter & { last?: FakeInstance }`. `FakeInstance` exposes `type(text)`, which simulates user input, plus `diagnostics` and `selection`. It passes the same contract suite.

- [ ] **Step 1: Spike.** Write `codemirror.test.ts` with only `// @vitest-environment happy-dom`. Mount `new EditorView({ parent })`, dispatch one change, and assert `view.state.doc.toString()`.
  - **If it passes:** continue.
  - **If measurement APIs throw:** add `test/setup/dom-measure.ts`. It stubs `Range.prototype.getClientRects` and `getBoundingClientRect` to return empty rects, and `document.createRange` if it's missing. Register it in `vitest.config.ts` `setupFiles`; the stub is a no-op outside happy-dom.
  - **If CodeMirror still cannot run:** run the contract suite against `EditorState` transactions through the adapter's internal `apply` path, and record a ruling.
- [ ] **Step 2: Write the failing contract suite** `runAdapterContract(name, adapter)`:
  - `mount shows initial text`.
  - `user typing calls onChange with the full text`.
  - `applyChange does not call onChange`.
  - `applyChange keeps a selection outside the change`: the caret at offset 40, an external insert at offset 5 of 3 chars, gives a caret at 43.
  - `setDiagnostics replaces diagnostics`.
  - `reveal with select sets the selection`.
  - `setReadOnly blocks typing`.
  - `Mod-z calls onUndo and does not change text`.
  - `complete results are offered` (CodeMirror: `startCompletion` and `currentCompletions`).
  - `destroy removes DOM`.

  Run it from `codemirror.test.ts` and `fake-adapter.test.ts`.
- [ ] **Step 3: Extend `check-entry.mjs`.** `FORBIDDEN` gains `/editors/`, and the walk fails on any bare specifier starting with `@codemirror/`. Add a unit test that walks a temp graph containing `import '@codemirror/view'` and expects a violation.
- [ ] **Step 4: Implement the adapter and fake.** Update `package.json` and `pack-check.mjs`. Install with `pnpm install`.
- [ ] **Step 5:** Run `pnpm --filter @stack-weaver/core test && pnpm --filter @stack-weaver/core build && node packages/core/scripts/check-entry.mjs && pnpm pack:check`. Expected: all PASS.
- [ ] **Step 6:** Commit `feat(core): CodeEditorAdapter interface and CodeMirror 6 adapter`.

### Task 5: `createManifestEditor` (shell, code mode and host API)

**Files:**
- Create:
  - `packages/core/src/editor/editor.ts` (`createManifestEditor`);
  - `context.ts`, the internal `EditorContext`;
  - `formats.ts`, built-in lazy formats and detection;
  - `shell.ts`, the top bar and panes;
  - `code-pane.ts`;
  - `messages.ts` (`UiMessages`, `defaultUiMessages`);
  - `dom.ts`, the `h()` helper;
  - `packages/core/src/styles/stack-weaver.css`;
  - `packages/core/scripts/copy-css.mjs`.
- Modify: `packages/core/src/index.ts`, `packages/core/package.json` (`build` runs `copy-css`; `exports`; `sideEffects`).
- Test: `packages/core/test/editor/editor.test.ts`, `formats.test.ts`

**Interfaces:**
- Consumes: `DocumentStore`, `detectFormat`, `mergeGuide`, `CodeEditorAdapter`, and the fake adapter.
- Produces (public):
  ```ts
  type EditorMode = 'visual' | 'split' | 'code';
  interface ManifestEditorOptions {
    format?: 'kubernetes' | 'compose' | 'auto' | (string & {});   // default 'auto'
    value?: string; mode?: EditorMode;                            // default '' and 'split'
    readOnly?: boolean; theme?: 'light' | 'dark' | 'auto';         // default false, 'auto'
    codeEditor?: CodeEditorAdapter;                               // default: lazy codemirrorAdapter()
    formats?: readonly FormatDefinition[];                        // extra/override formats, by id
    guide?: Readonly<Record<string, GuideOverride>>;              // keyed by format id
    messages?: { ui?: Partial<UiMessages>; schema?: Partial<SchemaMessages> };
    onChange?(value: string, meta: { origin: ChangeOrigin }): void;
    onProblemsChange?(problems: readonly Problem[]): void;
    onModeChange?(mode: EditorMode): void;
  }
  interface ManifestEditor {
    getValue(): string; setValue(text: string): void;
    getMode(): EditorMode; setMode(mode: EditorMode): void;
    getProblems(): readonly Problem[];
    setReadOnly(readOnly: boolean): void;
    undo(): boolean; redo(): boolean;
    reveal(ref: NodeRef): void;
    readonly ready: Promise<void>;     // resolves once the format, adapter and first validation are in place
    destroy(): void;
  }
  function createManifestEditor(el: HTMLElement, options?: ManifestEditorOptions): ManifestEditor;
  ```
  - **Internal:**
    - `EditorContext`:
      ```ts
      {
        store; messages; format(): FormatDefinition | undefined; guide(): Guide; readOnly(): boolean;
        problems(): readonly Problem[];
        bundleFor(doc): SchemaBundle | undefined;
        loadBundle(doc): Promise<SchemaBundle | undefined>;
        revealRange(r: TextRange): void;
        select(ref: NodeRef): void;
        onProblems(fn): () => void;
      }
      ```
    - The `Pane` interface: `{ el; update(e: StoreEvent | null): void; reveal(ref): boolean; setReadOnly(b): void; destroy(): void }`.
    - `loadBuiltinFormats(): Promise<FormatDefinition[]>`, which does `import('../formats/kubernetes/index.js')` and the compose equivalent.
  - **`origin` meta [ruling]:** `onChange`'s meta `origin` is the full `ChangeOrigin`, `'history'` included. The spec's line is corrected in Task 12.

- [ ] **Step 1: Write failing tests** with the fake adapter and `vi.useFakeTimers()`:
  - **Values and modes:**
    - `getValue returns the initial value`.
    - `typing in code calls onChange synchronously with origin 'code'`.
    - `setValue with equal text is a no-op` (no `onChange`, no `applyChange`).
    - `setValue applies a minimal splice` (fake records `applyChange({from: 10, to: 13, insert: 'xyz'})`, not a full replace).
    - `setMode switches panes and calls onModeChange`.
    - `mode switch is an APG radio group`: `role=radiogroup`; arrow keys move and select; checked has `tabindex=0`, others `-1`.
  - **Undo, read-only and theme:**
    - `Mod-z calls store.undo exactly once`, both from a visual input and from the code pane, where the fake adapter's `onUndo` is the only caller.
    - `ready resolves with format 'auto' and empty text`. No format is a valid resolved state.
    - `undo/redo buttons reflect canUndo/canRedo` (they are `disabled`).
    - `readOnly disables typing and edit buttons`.
    - `theme auto sets data-sw-theme from matchMedia`.
  - **Format resolution (`formats.test.ts`):**
    - `auto detects compose from text`.
    - `auto with empty text has no format until a recipe is chosen`.
    - `explicit format wins`.
    - `host formats override built-ins by id`.
    - `badge shows label and version`.
    - `guide override applies per format`.
  - **Lifecycle:**
    - `default adapter is loaded lazily` (spy on the dynamic import through an injectable `loadDefaultAdapter` in `context.ts`).
    - `no callbacks after destroy`: `destroy()` before a deferred `loadSchema` promise resolves; then resolve it; no `onProblemsChange`, and `el` is empty.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The **shell** sits under `el` in a `div.sw-editor` with `data-sw-theme`. It has:
    - a top bar `.sw-topbar`: the format badge, the mode radio group, the undo/redo buttons and a problem-count placeholder (filled in by Task 6);
    - a body `.sw-body` with `.sw-pane-visual` and `.sw-pane-code`. Split puts them side by side above 720 px wide and stacks them below that.
  - **Code pane:** mounts the adapter with `onChange: (t) => store.setText(t, 'code')`. Store events whose origin is not `'code'` call `instance.applyChange(e.change)`. If `instance.getText() !== store.text` afterwards, it rebuilds with one full-range change. This is a safety net and must never trigger in tests.
  - **Mod-z handling:** a `keydown` listener on the root, in the capture phase, takes Mod-z/Mod-Shift-z/Mod-y from inputs too, calls `preventDefault` and routes to the store. It **ignores events whose target is inside `.sw-pane-code`**, because the adapter's keymap owns undo there. One keypress is exactly one undo.
  - **CSS:** the stylesheet defines the light and dark `--sw-*` tokens (`--sw-bg`, `--sw-fg`, `--sw-muted`, `--sw-border`, `--sw-accent`, `--sw-error`, `--sw-warning`, `--sw-info`, `--sw-focus`, `--sw-radius`, `--sw-gap`, `--sw-font`, `--sw-mono`) and the layout. `copy-css.mjs` copies it to `dist/stack-weaver.css`.
- [ ] **Step 4:** Run the core tests, typecheck, build and `check-entry`. Expected: PASS. The entry graph has no CodeMirror and no format modules.
- [ ] **Step 5:** Commit `feat(core): createManifestEditor shell, code mode and host API`.

### Task 6: Problems pipeline, assist wiring and starter recipes

**Files:**
- Create:
  - `packages/core/src/editor/problems.ts`, the scheduler;
  - `problems-panel.ts`;
  - `recipes.ts`, the empty state;
  - `packages/core/src/formats/kubernetes/recipes.ts`, `packages/core/src/formats/compose/recipes.ts`.
- Modify: `packages/core/src/formats/types.ts` (adds `Recipe` and `FormatDefinition.recipes?`), `editor.ts`, `code-pane.ts`, `shell.ts`, both format `index.ts` files.
- Test: `packages/core/test/editor/problems.test.ts`, `recipes.test.ts`, `packages/core/test/formats/recipes.test.ts`

**Interfaces:**
- Consumes: `validateText`, `completionsFor`, `cursorContext`, `hoverAt`, `breadcrumbAt`, `EditorContext`, `Pane`.
- Produces:
  - `interface Recipe { readonly id: string; readonly format: string; readonly title: string; readonly description: string; readonly yaml: string; readonly focus?: NodeRef }`.
  - `FormatDefinition.recipes?: readonly Recipe[]`, and `ManifestEditorOptions.recipes?: readonly Recipe[]`. Host recipes are added to the built-ins, and a host recipe replaces a built-in one with the same `id`.
  - The built-in recipe ids are:
    - Kubernetes: `k8s-web-app` (Deployment, Service, Ingress), `k8s-worker`, `k8s-scheduled-job` (CronJob), `k8s-config` (ConfigMap, Secret);
    - compose: `compose-web-app`, `compose-app-postgres`, `compose-app-redis`.
  - `focus` points at the value that most needs replacing, for example the container `image`.
  - **Ruling:** recipes are offered only while the document is empty. Kubernetes additions after that go through the Add resource picker.

- [ ] **Step 1: Write failing tests:**
  - **Built-in recipes (`formats/recipes.test.ts`):**
    - `every built-in recipe validates with zero errors` (`validateText` problems with `severity: 'error'` is `[]`).
    - `every recipe is detected as its format`.
    - `every focus ref resolves to a scalar` (`describeNode(...).type === 'scalar'`).
    - `recipe ids are unique`.
  - **Problems (`problems.test.ts`):**
    - `validation runs 150 ms after the last change`.
    - `stale results are dropped` (text A starts; text B arrives before A's deferred load resolves; only B's problems are published).
    - `diagnostics reach the adapter`.
    - `problem count and live region update` (`role=status`, "2 problems").
    - `problems panel lists problems and click reveals the range in code`.
    - `broken YAML shows yaml.syntax problems`.
    - `completion source returns completionsFor results through the adapter`.
    - `hover source returns hoverAt`.
    - `breadcrumb follows the selection`.
  - **Empty state (`recipes.test.ts`):**
    - `empty document shows recipe cards for the format`.
    - `auto + empty shows recipes of every format, grouped by format label`.
    - `choosing a recipe sets text with origin 'api', fixes the format and reveals focus in code`.
    - `Start blank hides cards and focuses code`.
    - `host recipes add to built-ins and replace by id`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Scheduler:** a sequence counter. On publish it calls `onProblemsChange`, the adapter's `setDiagnostics` and the panel.
  - **Bundle cache:** keyed by `kindKey(apiVersion, kind)` for Kubernetes and by the format id for compose. It is filled by `loadBundle(doc)`, which validation and completion call.
  - **Problems panel:** a list under the panes, collapsible, with the count in the top bar. Each item is a button: severity icon, message, `line:col`. The icon has text alternatives, not colour alone.
  - **Recipe cards:** buttons in a `.sw-recipes` grid with the title and description, plus "Start blank".
  - **Recipe content:** real, minimal and valid. Use `nginx:1.27` and `postgres:17` style images, `resources.requests`, and probes where the guide recommends them.
- [ ] **Step 4:** Run the core tests and the build. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): validation pipeline, problems panel, code assist wiring, starter recipes`.

> **Midpoint check.** Code mode, the host API, problems and recipes work end to end. If execution pauses, it pauses here.

### Task 7: Visual pane (outline, sections, banner and split sync)

**Files:**
- Create:
  - `packages/core/src/visual/outline-model.ts` (DOM-free), `outline.ts` (APG Tree DOM), `section.ts`, `visual-pane.ts`, `banner.ts`;
  - `packages/core/test/visual/outline-model.test.ts`, `outline.test.ts`, `visual-pane.test.ts`.
- Modify: `packages/core/src/editor/editor.ts` (mounts the visual pane in `visual` and `split`), `messages.ts`, `stack-weaver.css`.

**Interfaces:**
- Consumes: `describeNode`, `toData`, `EditorContext`, `Pane`, `kindKey`, `GuideKind`.
- Produces:
  ```ts
  interface OutlineNode {
    readonly id: string;                 // `${doc}:${path.join('/')}`
    readonly ref: NodeRef;
    readonly label: string;              // doc: `${guide kind label or kind} ${metadata.name}`; map key: guide label or key; seq item: item.name ?? `${messages.item} ${i + 1}`
    readonly type: 'document' | 'map' | 'seq';
    readonly children: readonly OutlineNode[];   // only map/seq children (scalars are not outline nodes)
    readonly readOnly?: EditRefusal;
    readonly unknownKind?: boolean;
  }
  function buildOutline(p: ParsedText, format: FormatDefinition, labelFor: (ref: NodeRef, key: string) => string, messages: UiMessages): readonly OutlineNode[];
  ```
  - **Roots:**
    - for `rootModel: 'documents'`, one node per non-empty document;
    - for `'mapping'`, one node per top-level key of document 0.
  - **`section.ts`:** `mountSection(ctx: EditorContext, ref: NodeRef, slots: SectionSlots): { el: HTMLElement; update(): void; destroy(): void }`. It is stateful:
    - it keeps a `Map<pathKey, row>`;
    - `update()`, called on store events and on problem republishes, reuses rows by path and calls their `update`;
    - rows for vanished paths are destroyed, and rows for new paths are mounted in source order;
    - a focused input is never replaced.

    `SectionSlots` is the hook Tasks 8–10 fill: `{ field(row: FieldRowInit): { el: HTMLElement; update(value: YamlValue, readOnly: boolean, problems: readonly Problem[]): void; destroy(): void } | undefined; addSlot(ref): HTMLElement | undefined }`. Here `FieldRowInit = { ref: NodeRef; key: string | number; view: NodeView }`.

- [ ] **Step 1: Write failing tests:**
  - **Outline model (`outline-model.test.ts`):**
    - `documents become roots labelled by kind and name`.
    - `compose top-level keys become roots`.
    - `scalars are not outline nodes`.
    - `sequence items use name or "Item n"`.
    - `alias nodes are readOnly 'alias'`.
    - `unknown kind is marked and has no children`.
  - **Outline DOM (`outline.test.ts`, APG Tree):**
    - `role=tree with treeitems, aria-level, aria-expanded`.
    - `ArrowDown/ArrowUp/Home/End move focus`.
    - `ArrowRight expands then enters, ArrowLeft collapses then goes to parent`.
    - `Enter/click selects and renders the section`.
    - `only one treeitem has tabindex 0`.
  - **Visual pane (`visual-pane.test.ts`):**
    - `section shows heading, path breadcrumb and scalar rows as read text until Task 8 widgets exist`.
    - `visual re-renders 100 ms after a code change`.
    - `visual re-renders immediately after a visual or history change`.
    - `pending re-render flushes on pointerdown or focusin inside the visual pane`.
    - `selection survives re-render by node id`.
    - `visual is read-only while parse is broken`: the banner is `role=alert`; its "Jump to error" reveals the first `yaml.syntax` range; the pane shows `lastGood`; every control is disabled; `store.edit` is never called.
    - `unknown kind does not block later documents`: the CRD doc shows an "Unknown kind, edit in code" card, and doc 1, a Deployment, renders editable.
    - `read-only node shows "edit in code" link that reveals its range`.
    - `reveal(ref) selects the outline node`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Layout:** the outline on the left (`.sw-outline`) and the section in the centre (`.sw-section`), following frame 1.
  - **Labels:** `labelFor` uses `bundleFor(doc)`, then `resolveAt` for `defName`, then the `guideField` label, and falls back to the key. It re-renders when `loadBundle` resolves.
  - **Selection:** stored as an outline node id. When the id disappears, select the nearest existing ancestor.
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): visual pane with outline tree, sections, broken-YAML banner and split sync`.

### Task 8: Widget registry and built-in widgets

**Files:**
- Create: `packages/core/src/visual/widgets/registry.ts` (`pickWidget`, `defaultWidgets`), `text.ts` (string, number, integer, quantity, int-or-string), `choice.ts` (enum, boolean), `collections.ts` (string-list, key-value), `field-row.ts`
- Test: `packages/core/test/visual/widgets.test.ts`, `field-row.test.ts`

**Interfaces:**
- Consumes: `resolveAt`, `guideField`, `describeNode`, `DocumentStore.edit(op, {group})`, `SectionSlots.field`.
- Produces (public):
  ```ts
  interface WidgetContext {
    readonly id: string; readonly label: string; readonly description: string;
    readonly ref: NodeRef; readonly value: YamlValue; readonly schema: JsonSchema;
    readonly readOnly: boolean; readonly param?: string;          // from guide widget "name:param"
    readonly messages: UiMessages;
    parsed(): ParsedText;                                        // current parse, for suggestion widgets (Task 10)
    commit(value: ScalarValue): EditRefusal | undefined;         // set at ref, group "visual:<doc>:<path>"
    edit(op: EditOp): EditResult;                                // for composite widgets
  }
  interface WidgetInstance { readonly el: HTMLElement; update(value: YamlValue, readOnly: boolean): void; focus(): void; destroy?(): void }
  type WidgetFactory = (ctx: WidgetContext) => WidgetInstance;
  type WidgetRegistry = Readonly<Record<string, WidgetFactory>>;
  function pickWidget(r: ResolvedSchema, field: GuideField | undefined, registry: WidgetRegistry): { name: string; param?: string } | undefined;
  ```
  - `ManifestEditorOptions.widgets?: WidgetRegistry`, merged over `defaultWidgets` by name.
  - **Widget names:** `string`, `number`, `integer`, `boolean`, `enum`, `int-or-string`, `quantity`, `string-list`, `key-value`.
  - **`pickWidget` order:**
    1. The guide `widget` (`name` or `name:param`), if the registry has `name`. An unknown name falls through and never throws.
    2. `quantity`: an `anyOf` of `{type:'string', pattern}` and `{type:'number'}`.
    3. `int-or-string`: an `anyOf` of `integer` and `string`.
    4. `enum`, then `boolean`, `integer`, `number`, `string`.
    5. `key-value`: an object whose `additionalProperties` is a string schema and has no `properties`.
    6. `string-list`: an array of strings.
    7. Otherwise `undefined`, meaning a nested section card.

- [ ] **Step 1: Write failing tests:**
  - **`pickWidget`:**
    - `pickWidget follows guide, then schema shape` (one case per rule, using real resolved schemas: `Container#image`, `Container#imagePullPolicy`, `ContainerPort#containerPort`, `ResourceRequirements.limits.cpu`, `ServicePort#targetPort`, `ObjectMeta#labels`, `Container#args`).
    - `unknown guide widget falls back to schema`.
  - **Value handling:**
    - `number widget commits numbers, not strings`.
    - `int-or-string commits 8080 as number and http as string`.
    - `quantity widget flags an invalid value inline without committing`.
    - `typing commits per keystroke with one undo group` (three `input` events, then one `undo` restores the original).
    - `update does not clobber the focused input's caret` (a re-render while focused with the same value keeps `selectionStart`).
  - **Composite widgets:**
    - `key-value add/rename/remove use add/delete ops`.
    - `string-list push/remove`.
    - `every widget input is labelled` (`label[for]` or `aria-labelledby`).
  - **Field rows (`field-row.test.ts`):**
    - `row shows label, description, Required badge`.
    - `inline problems under the row match by path`.
    - `remove button deletes the field with accessible name "Remove <label>"`.
    - `anchored scalar shows the "changes every alias" note`.
    - `nested object field renders a card that selects the child node`.
    - `a field the schema does not know renders read-only with "edit in code"`. The spec says unknown fields inside known kinds are kept and shown read-only. An example is `spec.foo: 1` in a Deployment.
    - `while the bundle is loading, rows render read-only text and become widgets when it resolves`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Merge the host `options.widgets` over `defaultWidgets`.
  - **Field rows:** each field row fills `SectionSlots.field`.
  - **Sequences:** rows are labelled with the item summary (`name`, else "Item n").
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): widget registry and schema-driven field widgets`.

### Task 9: The add-here slot, Add resource picker and removing sections

**Files:**
- Create: `packages/core/src/visual/add-slot.ts`, `picker.ts`, `skeleton.ts`
- Test: `packages/core/test/visual/add-slot.test.ts`, `picker.test.ts`, `packages/core/test/editor/sync.test.ts`

**Interfaces:**
- Consumes: `addableAt`, `valueTemplateAt`, `kindCatalog`, `kindKey`, `EditResult.at`, `deleteDocument`, `SectionSlots.addSlot`.
- Produces:
  - `skeletonFor(entry: KindEntry, bundle: SchemaBundle, guide: Guide, eol: '\n' | '\r\n'): string`. It produces YAML for `apiVersion`, `kind`, `metadata.name` (the kind in lowercase, e.g. `deployment`), plus every other required top-level property from `valueTemplateAt`.
  - The add slot `renderAddSlot(ctx, ref): HTMLElement`:
    - **Layout:** a dashed region (`.sw-add-slot`) at the end of each section that can hold more. Missing **required** fields come first, then the tiers, with advanced behind a "Show advanced" disclosure (`aria-expanded`).
    - **Free-form maps:** for maps with `additionalProperties` or `patternProperties`, it shows an "Add key" name input plus a button. The value comes from `valueTemplateAt(path + [name])`.
    - **Sequences:** "Add item" pushes `valueTemplateAt(path + [0])`.

- [ ] **Step 1: Write failing tests:**
  - **Add slot (`add-slot.test.ts`):**
    - `slot lists missing fields by tier, required first`.
    - `advanced fields are behind a disclosure`.
    - `adding a field selects or focuses it via EditResult.at`.
    - `labels, annotations and compose services get "Add key"`.
    - `duplicate key shows the duplicate-key message`.
    - `Add item on a sequence pushes a template`.
    - `refused add (flow) shows "edit in code" link`.
  - **Picker (`picker.test.ts`, APG Dialog):**
    - `"+ Add resource" opens a modal dialog with focus on the search box`.
    - `intent groups list curated kinds in order`.
    - `search filters all kinds by kind name and description`.
    - `Escape closes and returns focus to the trigger`.
    - `Tab is trapped`.
    - `choosing Deployment appends a document from skeletonFor and selects it`.
    - `the skeleton validates with zero errors except placeholders`: `apps/v1/Deployment`'s skeleton may have errors only at required paths whose template is empty.
    - `remove section on a document uses deleteDocument after confirm`.
    - `compose root slot offers networks/volumes/configs/secrets`.
  - **Sync (`sync.test.ts`, integration with the CodeMirror adapter in happy-dom):**
    - `visual edit appears in code as a minimal change and keeps the code caret`.
    - `Mod-z in code undoes a visual edit`: `store.undo` is called exactly once.
    - `code edit appears in visual after 100 ms`.
    - If Task 4's spike fell back to the `EditorState`-only path, this file runs against the fake adapter instead.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement,** following frame 1:
  - **Root "+ Add resource":** shown for `'documents'` formats, where it opens the picker.
  - **Picker focus:** on close, focus returns to the trigger.
  - **Confirming removal:** an inline confirmation (`Remove` / `Cancel` buttons), not `window.confirm`.
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): add-here slot, Add resource picker and section removal`.

### Task 10: Guide curation, reference pickers and Secret data

**Files:**
- Modify: `packages/core/src/formats/kubernetes/guide.ts`, `packages/core/src/formats/compose/guide.ts`
- Create: `packages/core/src/visual/widgets/reference.ts` (`ref`, `ref-key`), `secret.ts` (`secret-data`), `packages/core/src/visual/suggest.ts`
- Test: `packages/core/test/formats/guides.test.ts` (extend), `packages/core/test/visual/reference.test.ts`, `secret.test.ts`

**Interfaces:**
- Produces:
  - **Curated guide fields** (`tier`, `label` and a plain-language `description` where the schema's is unclear) for the spec's v1 kinds:
    - Deployment, StatefulSet, Job, CronJob, Service, Ingress, ConfigMap, Secret, HorizontalPodAutoscaler, PersistentVolumeClaim, plus the shared `ObjectMeta`, `PodSpec`, `Container`, `ContainerPort`, `EnvVar` and `ServicePort` definitions;
    - for compose: `service`, `network`, `volume`, `config`, `secret`.
  - **Widget hints in guide data:**
    - `SecretKeySelector#name` and `SecretEnvSource#name`, and `SecretVolumeSource#secretName`: `widget: 'ref:Secret'`;
    - the `ConfigMap…` equivalents: `'ref:ConfigMap'`;
    - `SecretKeySelector#key`: `'ref-key:Secret'`, and `ConfigMapKeySelector#key`: `'ref-key:ConfigMap'`;
    - `Secret#data`: `'secret-data'`; `Secret#stringData` gets tier `recommended`.
  - `suggestNames(p: ParsedText, kind: 'Secret' | 'ConfigMap'): string[]` lists the `metadata.name` of the documents in the same text.
  - `suggestKeys(p, kind, name): string[]` lists that document's `data` and `stringData` keys, plus `binaryData` keys for a ConfigMap.
  - Widgets call these through `ctx.parsed()`. `ref-key` reads the sibling `name` value through `describeNode` on the parent map (`ctx.ref.path` minus the last key, plus `name`).

- [ ] **Step 1: Write failing tests:**
  - **Guide data (`guides.test.ts`):**
    - `every curated field key exists in the schema` (extends the Plan 1 drift test to all new keys).
    - `every v1 curated kind has at least one recommended field`.
    - `every guide widget name is in defaultWidgets` (or `ref`, `ref-key` or `secret-data`).
  - **References (`reference.test.ts`):**
    - `ref:Secret suggests Secret names from the same text` (`<datalist>`, free text still allowed).
    - `ref-key:Secret suggests keys of the named Secret`.
    - `no matching docs gives an empty list, not an error`.
  - **Secret data (`secret.test.ts`):**
    - `secret-data shows decoded UTF-8 values` (`cGFzc3fDtnJk` shows `passwörd`).
    - `editing re-encodes base64`.
    - `invalid base64 shows the raw value read-only with a warning`.
    - `secret-data has no Add key; the Secret section offers stringData`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Encoding:** `TextEncoder`, then `btoa` over the binary string.
  - **Decoding:** `atob`, then `TextDecoder('utf-8', { fatal: true })`. A `DOMException` or `TypeError` is treated as invalid base64.
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): curated v1 guide, reference pickers and Secret data widget`.

### Task 11: Visual focus for recipes and the accessibility pass

**Files:**
- Modify: `packages/core/src/editor/recipes.ts`, `visual-pane.ts`, `shell.ts`, `stack-weaver.css`, `messages.ts`
- Test: `packages/core/test/editor/a11y.test.ts`, `recipes.test.ts` (extend)

- [ ] **Step 1: Write failing tests:**
  - `choosing a recipe in visual or split focuses the widget at recipe.focus` (`document.activeElement` is that widget's input).
  - `every interactive element has an accessible name`: walk the editor DOM in each mode; every `button`, `input`, `select` and `[role]` has non-empty `textContent`, `aria-label`, `aria-labelledby` or `label[for]`.
  - `focus-visible styles exist for every interactive class`: parse `stack-weaver.css`; every `.sw-*` interactive selector has a `:focus-visible` rule.
  - `problem count is announced politely, banner assertively` (`aria-live` values).
  - `dark theme defines every token` (all `--sw-*` tokens in `[data-sw-theme="dark"]`).
  - `messages.ui overrides replace visible strings` (for example, `ui.addResource` changes the button text).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement the fixes** the tests expose.
- [ ] **Step 4:** Run the core tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): recipe focus in visual and accessibility pass`.

### Task 12: Playground, docs and release prep

**Files:**
- Create: `packages/core/examples/playground.html`, `packages/core/examples/playground.ts`, `packages/core/vite.config.ts`, `.changeset/editor-ui.md` (`"@stack-weaver/core": minor`)
- Modify:
  - `packages/core/package.json`: `"dev": "vite"` and the `vite` devDep;
  - `packages/core/README.md`: usage, options, CSS import, adapter, theming and messages;
  - `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`: the Host API corrections;
  - `docs/superpowers/notes/2026-10-30-plan-1-followups.md`: what Plan 2 did and didn't take.

- [ ] **Step 1: Build the playground.** The playground page has:
  - a mode and format toolbar;
  - a theme toggle;
  - a "setValue sample" button;
  - an `onChange`/`onProblemsChange` log.

  Run `pnpm --filter @stack-weaver/core dev`. Verify by hand with chrome-devtools MCP, against frames 1, 2, 2b and 3:
  - the sync in both directions;
  - the broken-YAML banner;
  - recipes for both formats;
  - the picker;
  - Secret decoding;
  - undo across panes;
  - the dark theme.

  Record the findings in the task report. Fix any defects in this task, each with a regression test.
- [ ] **Step 2: Update the docs.**
  - **Spec Host API:**
    - `messages?: { ui?: Partial<UiMessages>; schema?: Partial<SchemaMessages> }`;
    - `guide?: Record<formatId, GuideOverride>`;
    - `onChange` `origin: ChangeOrigin`;
    - `reveal(ref: NodeRef)`;
    - `setReadOnly`, `getMode`, `ready`;
    - `onVariablesChange` and `variables` stay listed as Plan 3.
  - **Follow-ups note:**
    - mark the items done;
    - carry forward full `yaml` decoupling, `DocumentStore.reset`/`clearHistory` and `transact`, all of which Plan 2 had no consumer for;
    - add anything parked in this plan.
- [ ] **Step 3:** Run `pnpm build && pnpm test && pnpm typecheck && node packages/core/scripts/check-entry.mjs && pnpm pack:check`. Expected: all PASS, and the entry graph has no CodeMirror or format modules.
- [ ] **Step 4:** Commit `docs: playground, README and spec updates for the editor UI`.

---

## Spec coverage in this plan, and what's deferred

- **Covered here:**
  - **Modes and sync:** the three modes and two-way sync (Tasks 5 and 7); the broken-YAML banner (7); the shared undo history (1, 4, 5).
  - **Visual editing:** the outline and the add-here slot (7, 9); the grouped picker (9); widgets by schema and guide (8); Secret base64 and reference pickers (10); read-only fallbacks with "edit in code" (7, 8, 9).
  - **Code editing:** the CodeMirror adapter behind a public interface (4); code completion with `boost` and `section`, hover and the breadcrumb (3, 6).
  - **Validation:** inline errors in both panes, the problems panel and the count (6, 8).
  - **Recipes:** recipes on empty documents (6, 11).
  - **Presentation:** `--sw-*` themes (5, 11); UI messages (5, 11); APG and WCAG work (5, 7, 9, 11); curated v1 guide data (10).
- **Plan 3:** compose variables (`VariableStore`, `x-variables`/external, the "use variable" toggle), placeholder substitution in validation, the 5 semantic rules, quick fixes.
- **Plan 4:** the React and Angular wrappers, `site/` with demo-kit, Lighthouse a11y = 100, release CI and trusted publishing, and restoring the Changesets `fixed` triple.
