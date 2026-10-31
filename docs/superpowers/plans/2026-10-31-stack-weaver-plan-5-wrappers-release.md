# stack-weaver Plan 5: Wrappers, Demos and Release Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@stack-weaver/react` and `@stack-weaver/angular` over the hardened core. Mirror them in a demo site
with Vanilla, React and Angular tabs. Make the three packages releasable as one fixed version group.

**Architecture:**
- **Layout:** mirrors `~/Developer/grid-master` (`@dash-builder/*`):
  - `packages/{core,react,demo-kit}`;
  - `packages/angular`, an Angular CLI workspace (private) whose published library is the inner
    `packages/angular/projects/stack-weaver-angular`;
  - `site/`, a multi-page Vite app.
- **Wrappers contain only wiring.** Every behaviour lives in the core. The core gets two small additive tasks first:
  - the R10 controller signals the wrappers need (Task 1);
  - the residual polish from the Plan 4 review (Task 2).
- **Nothing is published.** Release prep ends at a green `pnpm build && pnpm test && pnpm pack:check`, a correct
  `changeset status`, and CI, Pages and Release workflows ready for the maintainer's first manual publish.

**Tech Stack:**

| Area | Versions and tools |
|------|--------------------|
| Toolchain | pnpm 12.11.2, Node 22 (`.nvmrc`) |
| TypeScript | ^7.0.2 in core, react, demo-kit and site; **~6.0.2 in the Angular workspace** (grid-master's pin) |
| Tests | Vitest ^5.0.5, happy-dom ^21.0.4 |
| React | 19 (`react` / `react-dom` ^19.3.1 dev, peer ^19.0.0); `@testing-library/react` ^16.3.3, `@testing-library/dom` ^10.4.2; `@vitejs/plugin-react` ^6.1.2 |
| Angular | `@angular/{common,compiler,core,platform-browser}` ^22.2.0; `@angular/build` and `@angular/cli` exactly 22.2.4; `@angular/compiler-cli` ^22.2.0; `ng-packagr` ^22.2.0; `zone.js` ~0.16.3 (dev only); `rxjs` ~7.8.0; `tslib` ^2.3.0 |
| Site and release | Vite ^8.3.5; `@changesets/cli` ^2.31.1; `@arethetypeswrong/cli` ^0.18.5 |

Check exact Angular and React API details with context7 (user rule) before you write the code. Versions come from
grid-master's lockfile: use the same ranges.

**Spec:** `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`, sections "Packages and tooling", "Host API" (the
React and Angular bullets) and "Verification" (wrapper tests, mirrored demos, release checks). Plans 1–4 are merged
on `main` (2ed25c0).

**Inputs:** `docs/superpowers/notes/2026-10-30-plan-1-followups.md`, sections "Plan 5 (wrappers and release)", "Plan 5
wrapper contract" and "Deferred from the Plan 4 final review (E)". The grid-master facts this plan relies on are
copied into the tasks below. The full survey is `docs/superpowers/notes/2026-10-31-grid-master-survey.md` (Task 3
commits it). Read the section your task points to.

## Global Constraints

- **Plans 1–4 still apply in core:**
  - edits never reformat untouched lines;
  - every public export has TSDoc;
  - classes are `sw-*` and custom properties `--sw-*`;
  - never set `innerHTML` with document, guide, recipe or host strings;
  - one undo history (the store's);
  - the export list is pinned in `packages/core/test/index.test.ts`, so update it in the same commit as any export
    change;
  - `node scripts/check-entry.mjs` and, after a build, `node scripts/check-types.mjs` pass (in `packages/core`).
- **Core changes are additive.** No breaking change to the Plan 4 API.
- **Wrappers contain only wiring.** No editor behaviour, DOM or CSS of their own beyond the host element. Styles come
  only from `@stack-weaver/core/stack-weaver.css`; wrappers ship no CSS. A behaviour a wrapper needs and the core
  lacks is a core change, made in Task 1 or Task 2.
- **Same contract in both wrappers.** Any change to one wrapper comes with the same change in the other, and the test
  names match where the behaviour matches.
- **ESM only.** Every published package has an `exports` map with only `types` + `import`. attw runs with
  `--profile esm-only`.
- **Peers:**
  - wrappers peer on `"@stack-weaver/core": "workspace:0.x"` (never `workspace:^` before 1.0);
  - React wrapper: `react` / `react-dom` `^19.0.0`;
  - Angular wrapper: `@angular/common` / `@angular/core` `^22.0.0`;
  - wrappers have no runtime `dependencies`, except Angular's `tslib` from ng-packagr.
- **CodeMirror stays a peer of core only.** Wrapper tests inject `textareaAdapter()` from `@stack-weaver/demo-kit`
  (Task 3) instead of loading CodeMirror. `site/` and the Angular workspace list the `@codemirror/*` and
  `@lezer/highlight` peers as devDependencies, so the demos use the real CodeMirror adapter.
- **Wrapper tests:**
  - every test file spies on `console.error` and asserts it was not called in `afterEach` (core's `guarded()` logs
    there, so a callback throw or a double mount surfaces);
  - every test file has at least one render test with no manual `act()` (React) or `detectChanges()` (Angular)
    around the render;
  - React tests also run under `<StrictMode>`.
- **Accessibility:** demos and site follow WAI-ARIA APG patterns and WCAG 2.2 AA. The goal is Lighthouse
  accessibility = 100 in light and dark (checked in Task 9).
- **Repo metadata:** every published `package.json` has:
  - `license` MIT and `author` "Konstantin Penzin";
  - `homepage` `https://constantine-24.github.io/stack-weaver/`;
  - `repository` `{ type: git, url: git+https://github.com/Constantine-24/stack-weaver.git, directory }`;
  - `bugs`, `keywords`, `publishConfig.access: public`;
  - a byte-identical copy of the root `LICENSE`.

## Review Focus

These are the inputs most likely to bite a host. Each one is pinned by a test in the task named.
1. **An inline object prop (`guide={{…}}`, `[formats]="[…]"`) or a new callback on every render.** Callbacks must
   never recreate the editor. An object prop recreates it only when its reference changes, and the text, mode,
   format option, read-only state and theme survive the recreation. (Tasks 4 and 5)
2. **A controlled `value` the parent does not update on `onChange`.** The editor keeps the user's text. An unrelated
   re-render must not push the old value back. Only a *changed* `value` prop is pushed. (Tasks 4 and 5)
3. **A format bound two-way to the active format.** `format="auto"` must keep detecting after the text changes kind.
   The active format reaches the host through its own event and never writes back into `format`. (Tasks 4 and 5)
4. **StrictMode double mount, and unmounting before `ready` settles.** There must be exactly one live editor, no
   callback after unmount, and no unhandled rejection. (Tasks 4 and 5)
5. **Undo under `'auto'` after typing a text that detects as another format.** The format must not switch, because
   only API steps re-detect (R16). (Task 1)

## Decisions (rulings made while planning; each is the plan's authority)

- **Q1. R10 controller signals (additive core API).**
  - Options gain `onFormatChange?(activeFormat: string | undefined)`. It is called when the *resolved* format
    changes, whether by detection, `setFormat`, a recipe choice or a load. It is not called when only the option
    changes and the active format stays the same.
  - Options gain `onHistoryChange?(state: { readonly canUndo: boolean; readonly canRedo: boolean })`. It is called
    when either flag changes.
  - The controller gains `canUndo(): boolean` and `canRedo(): boolean`.
  - The controller gains `clearHistory(): void`, which drops undo and redo and leaves the text alone.
  - The controller gains `reset(text: string): void`. It replaces the text as one `'api'` change *and* drops the
    history (for example, "open another file"). `onChange` fires when the text differs, and under `'auto'` the
    format is detected again.
  - The format *option* never changes except through the API, so there is no option event. A recipe choice fixes
    the active format only.
  - *Cost if wrong:* an extra callback pair, which is easy to deprecate.
- **Q2. R16 origin per history step.**
  - `StoreEvent` gains `step?: ChangeOrigin`, set on `'history'` events to the origin of the undone or redone step.
    A step has a single origin because only `'code'` + `'code'` and same-group `'visual'` changes merge.
  - Under `'auto'`, undo and redo re-detect only when `step === 'api'`.
  - *Cost if wrong:* undoing an API `setValue` of another format's text still re-detects, which is intended.
- **Q3. Wrapper prop classes.**
  - **Settable** (pushed with `update()`, only the keys that changed): `value`, `mode`, `readOnly`, `theme`,
    `format`, and `variables.value` when the store is `external`. `variables.value` is compared by reference
    because `update({ variables })` re-applies even when equal.
  - **Init-only** (a new reference recreates the editor): `codeEditor`, `formats`, `recipes`, `guide`, `widgets`,
    `messages`, and the variables *store kind* (compared by `store`, not by reference).
  - **What survives a recreation:** the wrapper passes the old editor's `getValue()`, `getMode()`, `getFormat()`,
    `getReadOnly()` and the current theme as the new editor's initial options, then destroys the old editor. The
    undo history is lost, and both READMEs say so and ask for stable objects (module constants, `useMemo`, class
    fields).
  - *Cost if wrong:* hosts with inline objects get recreated editors, but no lost text.
- **Q4. Echo filtering.**
  - The wrapper sets a `pushing` flag around its own `update()` call and does not forward `onChange` (React) or
    write `value` (Angular) while the flag is set.
  - Changes the host makes through the controller (`ref.current.setValue`, origin `'api'`) are forwarded.
  - Do not filter on `origin === 'api'`.
- **Q5. Controlled value semantics.**
  - React: `value` (controlled) or `defaultValue` (initial only). A `value` prop is pushed only when it differs from
    the previous render's `value` prop *and* from `getValue()`. The editor never reverts the user's text to a stale
    prop.
  - Angular: `value = model<string>('')`. It is written from `onChange` and pushed by an effect when it differs from
    the last value the wrapper wrote and from `getValue()`.
  - `mode` follows the same rule (React `mode` / `onModeChange`; Angular `mode = model<EditorMode>('split')`).
- **Q6. Format binding (Plan 5 contract, R8).**
  - React: `format` is a prop (the option), and `onFormatChange` reports the active format.
  - Angular: `format = input<string>('auto')` (the option) and `activeFormatChange = output<string | undefined>()`.
  - There is no `[(format)]` two-way binding, because the editor never changes the option itself.
- **Q7. Naming.**
  - React: `ManifestEditor` and `ManifestEditorProps`. `ref` (React 19 ref-as-prop, no `forwardRef`) receives the
    live `ManifestEditorController`, or `null` when unmounted. It changes identity when the editor is recreated.
  - Angular: `SwManifestEditor`, selector `sw-manifest-editor`, prefix `sw`. The component exposes
    `controller(): ManifestEditorController | undefined`.
  - Inner project `projects/stack-weaver-angular`, dist `packages/angular/dist/stack-weaver-angular`, published files
    `fesm2022/stack-weaver-angular.mjs` and `types/stack-weaver-angular.d.ts`.
- **Q8. Test adapter in demo-kit.** `@stack-weaver/demo-kit` exports `textareaAdapter(): SyncCodeEditorAdapter`, a
  `<textarea>` code editor that is synchronous and needs no peers. Wrapper and site tests use it, which avoids three
  copies of a fake adapter. It is not published (demo-kit is private).
- **Q9. Theme in the demos.**
  - The site and each demo have a theme control (Auto / Light / Dark, an APG radio group). It is stored in
    `localStorage` under `stack-weaver-site-theme`, so the iframes and a Lighthouse reload see it.
  - The demo sets the editor's `theme` prop and the page's `data-theme`.
  - The Lighthouse dark run sets the control to Dark first. No cross-frame messaging: each frame reads the key at
    load and on the `storage` event.
- **Q10. No per-wrapper dev demos.** `site/` is the demo for all three frameworks: `pnpm --filter
  @stack-weaver/site dev` for Vanilla and React, `ng serve site-demo` for Angular. This differs from grid-master,
  whose `packages/react/demo` and Angular `demo` project duplicate the site. The core playground
  (`packages/core/examples`) stays as the core's own dev bench.
- **Q11. First version.**
  - All three packages start at version `0.0.0`. Core goes from 0.1.0 to 0.0.0: it was never published, and no
    CHANGELOG exists.
  - The five pending core changesets are folded into one `.changeset/first-release.md` (`minor` for all three:
    "First public release …"), so the first CHANGELOG entry is 0.1.0 and has no "Breaking" lists aimed at
    unpublished code.
  - The git history keeps the old changeset texts.
  - `pnpm changeset status --verbose` must list all three packages at 0.1.0.
- **Q12. CI gates beyond grid-master.** CI and `release` also run `node packages/core/scripts/check-entry.mjs` and
  `node packages/core/scripts/check-types.mjs` after the build.

---

### Task 1: Core: controller change signals (R10) and per-step history origin (R16)

**Files:**
- Modify: `packages/core/src/document/store.ts` (the `Entry` gets an `origin`; `StoreEvent.step`)
- Modify: `packages/core/src/editor/editor.ts` (options, controller, `refreshHistory` at ~:416, `applyFormat`,
  the `redetect` condition at ~:555)
- Modify: `packages/core/README.md` (Host API: new options and methods)
- Create: `.changeset/controller-signals.md` (core `minor`; Task 8 folds it in)
- Test: `packages/core/test/document/store.test.ts`, `packages/core/test/editor/controller-signals.test.ts` (new)

**Interfaces:**
- Produces (core, exported through the existing `ManifestEditorOptions` / `ManifestEditorController` types):
  - `ManifestEditorOptions.onFormatChange?: (activeFormat: string | undefined) => void`
  - `ManifestEditorOptions.onHistoryChange?: (state: { readonly canUndo: boolean; readonly canRedo: boolean }) => void`
  - `ManifestEditorController.canUndo(): boolean`, `canRedo(): boolean`, `clearHistory(): void`,
    `reset(text: string): void`
  - `StoreEvent.step?: ChangeOrigin`, present only when `origin === 'history'`
- Notes for the implementer:
  - The store's `subscribe` fires only on text changes, and `clearHistory()` / `reset(equalText)` change the flags
    silently. So emit `onHistoryChange` from the controller: compare the last emitted `{canUndo, canRedo}` inside
    `refreshHistory()` and call `refreshHistory()` from `clearHistory`, `reset` and `setReadOnly`.
  - `canUndo()` is the store's flag and ignores read-only. The shell buttons keep their own read-only rule.
  - Emit `onFormatChange` from `applyFormat` (every path that changes `format` goes through it). Compare by format
    id. A replaced definition with the same id is not a change.
  - Both callbacks run under `guarded()` and never fire after `destroy()`.

- [ ] **Step 1: Write the failing tests.**
  - In `store.test.ts`:
    - `undo/redo events carry the step origin`: `setText('a','api'); setText('ab','code'); undo()` emits `{ origin:
      'history', step: 'code' }`; a second `undo()` emits `step: 'api'`; `redo()` emits `step: 'api'`.
    - `a visual edit step reports 'visual'`.
  - In `controller-signals.test.ts` (fake adapter from `test/helpers/fake-adapter.ts`, `await editor.ready`):
    - `onHistoryChange fires on the first undoable change and when undo empties the stack` (sequence
      `[{canUndo:true,canRedo:false}]`, then `[…,{canUndo:false,canRedo:true}]`).
    - `onHistoryChange is not repeated for a second change with the same flags`.
    - `clearHistory() drops undo and redo and reports {false,false}; the text is unchanged`.
    - `reset(text) replaces the text, fires onChange once with origin 'api', and leaves nothing to undo`.
    - `reset(sameText) only clears the history: no onChange`.
    - `canUndo()/canRedo() mirror the store`.
    - `onFormatChange reports detection under auto`: `value` is compose text, then the callback gets `'compose'`;
      `setValue(k8s)` gives `'kubernetes'`; `setValue` with other compose text gives no call.
    - `onFormatChange fires for setFormat to a fixed id and not for setFormat('auto') that resolves to the same
      format`.
    - `R16: undo of typed text under auto keeps the format`: start with k8s text (`'kubernetes'`), the fake adapter
      types compose text (origin `'code'`; the format stays kubernetes), then `undo()`, `redo()`: `getActiveFormat()`
      stays `'kubernetes'` throughout and `onFormatChange` is not called.
    - `R16: undo of an API setValue re-detects`: `setValue(compose)` then `undo()` gives `'kubernetes'` again.
    - `no signal after destroy`.
- [ ] **Step 2: Run `pnpm --filter @stack-weaver/core test -- controller-signals store`.** Expected: FAIL. The members
  do not exist yet.
- [ ] **Step 3: Implement.**
  - **Store:** `Entry.origin: ChangeOrigin` is set by `#commit`. A merged change keeps the entry's origin. `undo` /
    `redo` pass the entry's origin as `step`.
  - **Editor:** add the options and methods. `reset` → `store.reset(text)` plus `refreshHistory()`; the existing
    subscription handles the text change. `clearHistory` → `store.clearHistory()` plus `refreshHistory()`. Change
    the re-detect condition to `!format || e.origin === 'api' || (e.origin === 'history' && e.step === 'api')`.
  - **TSDoc:** update the `format` option TSDoc ("and on undo and redo of API changes"). Add TSDoc to every new
    member.
- [ ] **Step 4: Run the core suite, `pnpm --filter @stack-weaver/core typecheck`, then `node scripts/check-entry.mjs`
  in `packages/core`.** Expected: PASS. Update existing tests that asserted re-detect on undo of typed text: R16
  changes that behaviour on purpose.
- [ ] **Step 5: Docs and changeset.**
  - README Host API: add the two callbacks and four methods, with one sentence on R16.
  - `.changeset/controller-signals.md`: an "Added" list.
- [ ] **Step 6: Commit** `feat(core): controller history and format signals, reset/clearHistory; re-detect only API history steps (R10, R16)`.

### Task 2: Core: Plan 4 review residuals (batch)

One dispatch, several small independent edits.

**Files:** `packages/core/src/editor/code-pane.ts`, `packages/core/src/visual/widgets/registry.ts`,
`packages/core/src/editor/messages.ts`, `packages/core/src/editor/editor.ts` (`redetect`), `packages/core/src/validation/validate.ts`,
the widget-host code that logs `widgetFailed` (find it with `grep -rn widgetFailed src`), `packages/core/src/editor/recipes.ts`,
`packages/core/test/editor/quick-fix.test.ts`, plus the matching tests.

**Interfaces:** none new. `defaultWidgets` and `defaultUiMessages` become frozen; their types are unchanged.

- [ ] **Step 1: Failing tests, one per item.**
  - (a) **S4:** `completion and hover failures are logged with console.debug`. The fake adapter's `complete` and
    `hover` are called with a host format whose `complete` throws; `console.debug` is called once with a
    `stack-weaver:` message, and `console.error` is not called.
  - (b) **S8:** `a widget whose create and destroy both throw is logged once per failure, not twice for destroy`.
  - (c) **Freeze:** `defaultWidgets and defaultUiMessages are frozen`: `Object.isFrozen(...)` is true for both, and
    assigning a key throws in strict mode.
  - (d) **Detect throw rate limit:** `a throwing host detect under auto logs once until detection succeeds`. Type 5
    times and `console.error` is called once. After a successful detect, a new throw logs again.
  - (e) **'failed' dedupe per format:** `the reserved 'failed' rule id warns once per format`. Two formats with a
    `failed` rule give two warnings, and the same format twice gives one.
  - (f) **S7:** `choosing a recipe whose format is not loaded warns once and still inserts the text`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - (a) Replace the bare `catch {}` blocks in `code-pane.ts`'s assist callbacks with `catch (err) {
    console.debug('stack-weaver: …', err) }`. Keep the same return values.
  - (b) Skip the second log when the instance already reported `widgetFailed`.
  - (c) `Object.freeze` at the definition.
  - (d) Keep `lastDetectError: string | undefined`. Log when the message differs, and clear it after a detect that
    does not throw.
  - (e) The `warnOnce` key includes the format id.
  - (f) Add `warnOnce` in `choose`.
  - Also: replace `quick-fix.test.ts`'s local `visibleFocus` / `live` copies with the shared `test/helpers/focus.ts`
    helper. Add one sentence to the `ActionRefusal`/`transact` TSDoc (S6): a multi-op refusal reports the first
    refused op's reason, not its index.
- [ ] **Step 4: Run the core suite and typecheck.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(core): Plan 4 review residuals (debug logs, single widget log, frozen defaults, detect log rate limit, per-format warnings)`.
  Add one line to `.changeset/controller-signals.md` ("`defaultWidgets` and `defaultUiMessages` are now frozen").
  Mark these items done in the follow-ups note.

### Task 3: `@stack-weaver/demo-kit` (private) + workspace wiring

**Files:**
- Create: `packages/demo-kit/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,scripts/copy-css.mjs}`
- Create: `packages/demo-kit/src/{index.ts,examples.ts,theme.ts,site.ts,status.ts,textarea-adapter.ts,theme.css,controls.css}`
- Create: `packages/demo-kit/test/demo-kit.test.ts`
  The controller does this copy before dispatching, if the scratchpad is gone.

**Interfaces:**
- `package.json`:
  - `"name": "@stack-weaver/demo-kit"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`;
  - exports: `"."` → `{ types: ./dist/index.d.ts, import: ./dist/index.js }`, plus `"./theme.css"` and
    `"./controls.css"` → `./dist/*.css`;
  - `"sideEffects": ["*.css"]`, `"files": ["dist"]`;
  - scripts: `build` = `tsc -p tsconfig.build.json && node scripts/copy-css.mjs`, `test` = `vitest run`,
    `typecheck` = `tsc --noEmit -p tsconfig.json`;
  - devDeps: `@stack-weaver/core` `workspace:*`, `typescript` ^7.0.2, `vitest` ^5.0.5, `happy-dom` ^21.0.4.
  - Configs mirror `packages/core`'s `tsconfig*.json`, extending `../../tsconfig.base.json`. Vitest uses
    `environment: 'happy-dom'` and `include: ['test/**/*.test.ts']`.
- Produces (all exported from `src/index.ts`):
  - `interface DemoExample { readonly id: 'kubernetes' | 'compose' | 'compose-external' | 'empty' | 'broken'; readonly label: string; readonly format: 'kubernetes' | 'compose' | 'auto'; readonly value: string; readonly variables?: VariablesOption }`
  - `const EXAMPLES: readonly DemoExample[]`, in this order:
    - Kubernetes web app (Deployment + Service + Ingress);
    - Compose with `x-variables` (the core playground's `COMPOSE_VARS`);
    - Compose with external variables (`variables: { store: 'external', value: EXTERNAL_VARS }`);
    - Empty (`format: 'auto'`, value `''`, so the recipes show);
    - Broken YAML (`format: 'kubernetes'`, a k8s text with an unclosed flow map, so the banner shows).
    The texts come from `packages/core/examples/playground.ts`, extended for Service and Ingress.
  - `const MODES: readonly { readonly mode: EditorMode; readonly label: string }[]`: Visual, Split, Code.
  - `type SiteTheme = 'auto' | 'light' | 'dark'`; `const THEMES: readonly { readonly theme: SiteTheme; readonly label: string }[]`.
  - `const THEME_KEY = 'stack-weaver-site-theme'`.
  - `readTheme(storage?: Storage): SiteTheme`. Default `'auto'`. An unknown or unreadable value gives `'auto'`.
  - `writeTheme(theme: SiteTheme, storage?: Storage): void`. Swallows storage errors.
  - `applyPageTheme(doc: Document, theme: SiteTheme): void`: sets `data-theme` on `<html>`, or removes it for
    `'auto'`.
  - `statusLine(s: { problems: number; activeFormat: string | undefined; origin?: ChangeOrigin }): string`. For
    example `"2 problems · kubernetes · last change: code"` and `"No problems · no format yet"`, using `1 problem`
    for the singular.
  - `siteConfig(env: { GITHUB_REPOSITORY?: string; SHOW_NPM?: string }): SiteConfig`, where
    `SiteConfig = { name: 'stack-weaver'; base: string; repoUrl: string; showNpm: boolean }`. `base` is
    `/<repo>/` when `GITHUB_REPOSITORY` is set, else `/`. `repoUrl` defaults to
    `https://github.com/Constantine-24/stack-weaver`.
  - `docsLinks(repoUrl: string)`: blob/main README links for core, react, and angular (at
    `packages/angular/projects/stack-weaver-angular/README.md`).
  - `textareaAdapter(): SyncCodeEditorAdapter`:
    - mounts a labelled `<textarea class="demo-code">`, with `input` → `init.onChange`, Ctrl/Cmd+Z →
      `init.onUndo`, and Ctrl/Cmd+Shift+Z → `init.onRedo`;
    - `applyChange` splices the text and keeps the caret;
    - diagnostics are stored and readable through an `instances` list;
    - `setReadOnly` sets `readOnly`, and `destroy` removes the textarea.
    It replaces nothing in core. Use the core's `test/helpers/fake-adapter.ts` as the model, but with no test
    hooks except `type(text)`.
  - CSS:
    - `theme.css`: `--site-*` tokens for light and dark (`:root`, `[data-theme=dark]`, and
      `@media (prefers-color-scheme: dark)` for `:root:not([data-theme])`). It sets `color-scheme`.
    - `controls.css`: the focus ring; `.segmented` / `.segmented__option` radio groups for mode and theme; the
      toolbar; `.demo-status` (`role="status"` styling).
    - Every colour pair meets AA in both themes.
- Workspace: `pnpm-workspace.yaml` stays `packages/*` here (Task 8 adds the Angular inner path and `site`). Run
  `pnpm install`.

- [ ] **Step 1: Write the failing tests** in `test/demo-kit.test.ts`:
  - `every example parses and validates to the expected problem count`: build `parseText` and
    `createManifestEditor` with `textareaAdapter()`, `await ready`, then:
    - kubernetes, compose and compose-external have 0 error problems;
    - empty has 0 problems and shows `.sw-recipes` (use the class the core renders for recipe cards; grep
      `src/editor/recipes.ts`);
    - broken shows the banner.
  - `ids are unique and in order`.
  - `MODES are visual, split, code`.
  - `readTheme defaults to auto, round-trips writeTheme, ignores junk and a throwing storage`.
  - `applyPageTheme sets and clears data-theme`.
  - `statusLine pluralises and names the format`.
  - `siteConfig base and showNpm`.
  - `docsLinks point to the three READMEs`.
  - `textareaAdapter: typing calls onChange, applyChange keeps the caret, setReadOnly blocks input, destroy removes the textarea`.
- [ ] **Step 2: Run `pnpm --filter @stack-weaver/demo-kit test`.** Expected: FAIL (no sources).
- [ ] **Step 3: Implement** the sources listed above.
- [ ] **Step 4: Run `pnpm -r build && pnpm --filter @stack-weaver/demo-kit test && pnpm --filter @stack-weaver/demo-kit typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo-kit): shared demo examples, theme and status helpers, textarea test adapter`.

### Task 4: `@stack-weaver/react`

**Files:**
- Create: `packages/react/{package.json,tsconfig.json,tsconfig.build.json,vitest.config.ts,README.md,LICENSE,scripts/smoke.mjs}`
- Create: `packages/react/src/{index.ts,manifest-editor.tsx}`
- Create: `packages/react/test/{manifest-editor.test.tsx,ssr.test.tsx}`

**Interfaces:**
- `package.json` (grid-master `packages/react` shape, survey §2):
  - `"name": "@stack-weaver/react"`, `"version": "0.0.0"`, `"type": "module"`, `"sideEffects": false`;
  - `exports`: `"."` → `{ types: ./dist/index.d.ts, import: ./dist/index.js }`;
  - `files`: `["dist","README.md","LICENSE","CHANGELOG.md"]`;
  - scripts: `build` = `tsc -p tsconfig.build.json`, `test` = `vitest run`, `typecheck` =
    `tsc --noEmit -p tsconfig.json`, `test:smoke` = `pnpm build && node scripts/smoke.mjs`;
  - peers: `@stack-weaver/core` `workspace:0.x`, `react` ^19.0.0, `react-dom` ^19.0.0;
  - devDeps: core and demo-kit `workspace:*`, plus the testing-library, types, react, happy-dom, typescript and
    vitest versions from the Tech Stack.
  - Configs: `jsx: react-jsx`, built with plain tsc (no bundler), `.js` import suffixes. Vitest uses
    `environment: 'happy-dom'` and `include: ['test/**/*.test.tsx']`.
- Produces:
  ```ts
  export interface ManifestEditorProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onChange' | 'defaultValue'> {
    value?: string; defaultValue?: string;
    onChange?: (value: string, meta: { readonly origin: ChangeOrigin }) => void;
    mode?: EditorMode; onModeChange?: (mode: EditorMode) => void;
    format?: ManifestEditorOptions['format']; onFormatChange?: (activeFormat: string | undefined) => void;
    readOnly?: boolean; theme?: EditorTheme;
    variables?: VariablesOption; onVariablesChange?: (decls: readonly VariableDecl[]) => void;
    onProblemsChange?: (problems: readonly Problem[]) => void;
    onHistoryChange?: (state: { readonly canUndo: boolean; readonly canRedo: boolean }) => void;
    codeEditor?: CodeEditorAdapter; formats?: readonly FormatDefinition[]; recipes?: readonly Recipe[];
    guide?: ManifestEditorOptions['guide']; widgets?: WidgetRegistry; messages?: EditorMessages;
    ref?: Ref<ManifestEditorController | null>;
  }
  export function ManifestEditor(props: ManifestEditorProps): JSX.Element;
  ```
  `src/index.ts` exports `ManifestEditor` and `ManifestEditorProps`, and re-exports these core types:
  `ManifestEditorController`, `EditorMode`, `EditorTheme`, `ChangeOrigin`, `Problem`, `VariableDecl`,
  `VariablesOption`, `FormatDefinition`, `Recipe`.
- Mechanics (survey §2, "Mechanics"):
  - Render `<div {...rest} />` with no children; the core owns the children.
  - A `latest` ref holds the props. It is updated in the *first* `useLayoutEffect` (no deps).
  - The editor is created in a `useLayoutEffect` whose deps are the init-only values: `codeEditor`, `formats`,
    `recipes`, `guide`, `widgets`, `messages`, `variables?.store`. Callbacks are trampolines that read
    `latest.current`. Cleanup destroys the editor.
  - On re-creation, carry the text, mode, format, read-only state and theme over from the outgoing editor (Q3).
  - A sync `useLayoutEffect` (no deps) pushes the changed settable keys in one `update()` inside the `pushing` flag
    (Q4, Q5).
  - Attach `ref` with `useImperativeHandle(ref, () => editor, initDeps)`, declared after the create effect.
  - `ready` rejections are caught and dropped: the core already shows the failure.

- [ ] **Step 1: Write the failing tests** in `test/manifest-editor.test.tsx`. Use `textareaAdapter()` as
  `codeEditor`. In `afterEach`, run `cleanup()` and assert the `console.error` spy was not called.
  - `renders the editor for the initial value without act()`. Render, then `await waitFor` until `.sw-editor` (the
    core root class; grep `shell.ts`) exists and the textarea holds the value.
  - `StrictMode: exactly one editor root and one textarea`.
  - `typing calls onChange with origin 'code'`.
  - `controlled value: a changed prop is pushed and does not echo onChange`.
  - `controlled value: a parent that ignores onChange keeps the typed text across an unrelated re-render`.
  - `defaultValue is used once`.
  - `ref.current.setValue echoes onChange with origin 'api'`.
  - `mode prop and onModeChange`.
  - `readOnly and theme props are pushed`, which checks `getReadOnly()` and the root's theme attribute (grep
    `theme.ts` for the attribute).
  - `format='auto' keeps detecting while onFormatChange reports compose then kubernetes`. The host stores the active
    format in state and re-renders. `getFormat()` stays `'auto'`.
  - `inline callbacks: no recreation; the newest callback wins`. Re-render with a new `onChange` 5 times, then type.
    Only the last callback is called, and the `ref.current` identity is unchanged.
  - `a new guide object recreates the editor and keeps text, mode, format and readOnly`. `ref.current` changes
    identity, and the old controller's root is gone.
  - `a new variables.value with the external store is pushed without recreation; a changed store kind recreates`.
  - `onHistoryChange drives undo buttons`.
  - `unmount before ready: no callback after unmount, no unhandled rejection`. Use a `codeEditor` whose `mount`
    returns a never-settling promise, unmount, and type nothing.
  - `className and style on the host div survive re-renders`.
  - In `test/ssr.test.tsx`: `renders to a string without touching the DOM` uses `renderToString(<ManifestEditor
    value="a: 1" />)`, which returns a `<div>` string, and no `console.error`.
- [ ] **Step 2: Run `pnpm --filter @stack-weaver/react test`.** Expected: FAIL.
- [ ] **Step 3: Implement** `src/manifest-editor.tsx` and `src/index.ts`.
- [ ] **Step 4: Smoke script.** `scripts/smoke.mjs` asserts:
  - `dist/index.js` exists;
  - `import('@stack-weaver/react')` exposes `ManifestEditor` as a function;
  - the peer dependencies equal `{ '@stack-weaver/core': 'workspace:0.x', react: '^19.0.0', 'react-dom': '^19.0.0' }`;
  - there are no `dependencies`;
  - `LICENSE` exists.
  Copy the root `LICENSE` byte for byte.
- [ ] **Step 5: README** (sections: Install, including the CodeMirror peers or `codeEditor` / Styles / Usage /
  Rules / API props table / Demo / License):
  - **Rules:** pass stable objects; `value` is pushed only when it changes; recreation loses undo history; `ref`
    is the controller; `format` vs `onFormatChange`.
- [ ] **Step 6: Run `pnpm -r build && pnpm --filter @stack-weaver/react test && pnpm --filter @stack-weaver/react typecheck && pnpm --filter @stack-weaver/react test:smoke`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(react): ManifestEditor wrapper`.

### Task 5: `@stack-weaver/angular`

**Files:**
- Create: `packages/angular/{angular.json,package.json,tsconfig.json,scripts/smoke.mjs}`.
- Create: `packages/angular/projects/stack-weaver-angular/{package.json,ng-package.json,tsconfig.lib.json,tsconfig.lib.prod.json,tsconfig.spec.json,test-providers.ts,README.md,LICENSE}`.
- Create: `packages/angular/projects/stack-weaver-angular/src/{public-api.ts,lib/manifest-editor.component.ts,lib/manifest-editor.component.spec.ts,lib/zone.spec.ts}`.
- Modify: `pnpm-workspace.yaml`. Add the comment and the line
  `- "packages/angular/projects/stack-weaver-angular"` verbatim from survey §1.

**Interfaces:**
- **Outer `package.json`** (survey §3):
  - `"name": "@stack-weaver/angular-workspace"`, `"private": true`, `"version": "0.0.0"`;
  - scripts:
    - `"ng": "ng"`;
    - `"build": "ng build stack-weaver-angular"` (Task 7 appends `&& ng build site-demo`);
    - `"test": "ng test stack-weaver-angular --watch=false"`;
    - `"typecheck": "tsc --noEmit -p projects/stack-weaver-angular/tsconfig.lib.json"`;
    - `"test:smoke": "pnpm build && node scripts/smoke.mjs"`.
  - dependencies and devDependencies: as in the Tech Stack, plus `@stack-weaver/core` and `@stack-weaver/demo-kit`
    `workspace:*`. Also the `@codemirror/*` and `@lezer/highlight` versions from `packages/core/package.json`, for
    Task 7's demo.
- **`angular.json`:**
  - library project `stack-weaver-angular` with prefix `sw`;
  - build with `@angular/build:ng-packagr`. Production uses `tsconfig.lib.prod.json`
    (`compilationMode: "partial"`, `declarationMap: false`); development uses `tsconfig.lib.json`;
  - test with `@angular/build:unit-test`, options `{ tsConfig: …/tsconfig.spec.json, providersFile:
    …/test-providers.ts }`.
- **Root `tsconfig.json`:** copy grid-master's `packages/angular/tsconfig.json` and change the `paths` entry to
  `"@stack-weaver/angular": ["./dist/stack-weaver-angular"]`. It does not extend the repo base.
- **Inner `package.json`:**
  - `"name": "@stack-weaver/angular"`, `"version": "0.0.0"`, metadata per Global Constraints;
  - `peerDependencies`: `{ "@angular/common": "^22.0.0", "@angular/core": "^22.0.0", "@stack-weaver/core": "workspace:0.x" }`;
  - `"sideEffects": false`;
  - `"publishConfig": { "access": "public", "directory": "../../dist/stack-weaver-angular", "linkDirectory": false }`.
- **`ng-package.json`:** `{ "$schema": "../../node_modules/ng-packagr/ng-package.schema.json", "dest":
  "../../dist/stack-weaver-angular", "assets": ["LICENSE", "CHANGELOG.md"], "lib": { "entryFile":
  "src/public-api.ts" } }`. Create an empty-titled `CHANGELOG.md` stub (`# @stack-weaver/angular`) so the asset
  exists; Changesets writes the rest.
- **`test-providers.ts`:** `export default [provideZonelessChangeDetection()];`. The grid-master comment explains
  that zone.js is a devDep for `zone.spec.ts` only.
- **Produces:** `SwManifestEditor` (standalone, `ChangeDetectionStrategy.OnPush`, selector `sw-manifest-editor`,
  empty template, `host: { style: 'display: block' }`).
  - Two-way models: `value = model<string>('')` and `mode = model<EditorMode>('split')`.
  - Settable inputs:
    - `format = input<string>('auto')`;
    - `readOnly = input<boolean, unknown>(false, { transform: booleanAttribute })`;
    - `theme = input<EditorTheme>('auto')`;
    - `variables = input<VariablesOption | undefined>()`.
  - Init-only inputs: `codeEditor`, `formats`, `recipes`, `guide`, `widgets`, `messages`, all `input<… |
    undefined>()`.
  - Outputs: `problemsChange = output<readonly Problem[]>()`, `variablesChange = output<readonly VariableDecl[]>()`,
    `activeFormatChange = output<string | undefined>()`, `historyChange = output<{ canUndo: boolean; canRedo:
    boolean }>()`.
  - Method: `controller(): ManifestEditorController | undefined`.
  - `public-api.ts` exports `SwManifestEditor` and re-exports the same core types as the React package.
- **Mechanics** (survey §3):
  - The editor is created in `afterNextRender` (SSR-safe) inside `NgZone.runOutsideAngular`. Initial reads use
    `untracked`.
  - Core callbacks re-enter with `zone.run(() => …)`: `value.set`, `mode.set` and the outputs.
  - An `effect` over the init-only inputs (and `variables()?.store`) recreates the editor when one changes after
    creation, carrying state over (Q3).
  - An `effect` over the settable inputs pushes the changed keys in one `update()` with the `pushing` flag
    (Q4, Q5), run outside the zone.
  - `DestroyRef.onDestroy` destroys the editor.
  - Never write a signal from inside a render hook.

- [ ] **Step 1: Write the failing tests.**
  - `manifest-editor.component.spec.ts`:
    - Setup: a host test component binds the inputs; `textareaAdapter()` is the `codeEditor`; `console.error` spy;
      `create()` = `TestBed.createComponent` + `await fixture.whenStable()`.
    - The same behaviours as Task 4, under the same names where they match:
      - `renders the editor for the initial value without detectChanges()`;
      - typing → `[(value)]` updates with no echo;
      - a pushed `value` does not echo;
      - a parent value that stays the same keeps the typed text;
      - `[(mode)]`;
      - `readOnly` and `theme`;
      - `format='auto'` keeps detecting while `activeFormatChange` reports compose then kubernetes;
      - new init-only input reference → recreated, state kept;
      - external `variables.value` pushed, and a store kind change recreates;
      - `historyChange`;
      - destroy before ready → nothing after destroy;
      - `the core runs outside the Angular zone` (spy `NgZone.runOutsideAngular`).
  - `zone.spec.ts` (providers `provideZoneChangeDetection()`):
    - `typing re-enters the zone once per change and updates [(value)]`;
    - `the editor's own DOM listeners do not trigger app ticks`: dispatch `pointermove` / `scroll` on the editor and
      count `afterEveryRender` ticks with a positive control.
- [ ] **Step 2: Run `pnpm --filter @stack-weaver/angular-workspace test`.** Expected: FAIL.
- [ ] **Step 3: Implement** the component and `public-api.ts`.
- [ ] **Step 4: Smoke script.** `scripts/smoke.mjs` imports `@angular/compiler` first (partial compilation needs the
  JIT linker in Node), then imports `dist/stack-weaver-angular/fesm2022/stack-weaver-angular.mjs`. It asserts:
  - `SwManifestEditor` is exported;
  - `dist/stack-weaver-angular/LICENSE` exists;
  - the dist `package.json` name is `@stack-weaver/angular` and its peers equal the source peers;
  - `dependencies` holds `tslib` at most.
- [ ] **Step 5: README.** Same sections and rules as the React README, adapted (`[(value)]`, `[(mode)]`, `[format]`
  with `(activeFormatChange)`, `controller()` through `viewChild`). Intro: "Requires Angular 22. Works with and
  without zone.js: the editor's DOM listeners run outside the Angular zone, and state flows through signals."
  Copy `LICENSE`.
- [ ] **Step 6: Run `pnpm install && pnpm -r build && pnpm --filter @stack-weaver/angular-workspace test && pnpm --filter @stack-weaver/angular-workspace typecheck && pnpm --filter @stack-weaver/angular-workspace test:smoke`.** Expected: PASS.
- [ ] **Step 7: Commit** `feat(angular): sw-manifest-editor wrapper`.

### Task 6: `site/` with the Vanilla and React tabs

**Files:**
- Create: `site/{package.json,index.html,vite.config.ts,vitest.config.ts,tsconfig.json}`.
- Create: `site/src/{main.ts,config.ts,env.d.ts,frameworks.ts,vanilla-demo.ts,toolbar.ts,snippets.ts,footer.ts,theme-switch.ts,shared.css,styles.css}`.
- Create: `site/react/{index.html,main.tsx,app.tsx,app.css}`.
- Create: `site/scripts/{build.mjs,check-dist.mjs}`.
- Create: `site/test/{frameworks.test.ts,vanilla-demo.test.ts,react-app.test.tsx,theme.test.ts}`.
- Modify: `pnpm-workspace.yaml`. Add `- "site"`.

**Interfaces:**
- `package.json`:
  - `"name": "@stack-weaver/site"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`;
  - scripts: `dev` = `vite`, `build:site` = `node scripts/build.mjs`, `check` = `node scripts/check-dist.mjs`,
    `preview` = `vite preview`, `test` = `vitest run`, `typecheck` = `tsc --noEmit -p tsconfig.json`. There is no
    `build` script, so `pnpm -r build` skips the site;
  - devDeps: core, react, demo-kit and angular-workspace `workspace:*`; the CodeMirror and `@lezer/highlight` peers;
    the React, testing-library, vite and plugin-react versions from the Tech Stack.
- `vite.config.ts`:
  - `base` comes from `siteConfig(process.env).base`;
  - `define: { __SITE__: JSON.stringify(site) }`;
  - a `transformIndexHtml` plugin with `order: 'pre'` replaces `%SITE_NAME%`;
  - multi-page `build.rollupOptions.input`: `{ main: './index.html', react: './react/index.html' }`.
  - The vitest config has the same `define`, `environment: 'happy-dom'`, `include: ['test/**/*.test.{ts,tsx}']`,
    and `environmentOptions.happyDOM.settings: { enableIframePageLoading: true, navigation: {
    disableChildFrameNavigation: true } }`.
- **Page.** The header has the brand, nav links (`#demo`, `#frameworks`, and docs and GitHub links) and the theme
  switch. Then come:
  - the hero: the tagline from the spec Goals and the install command;
  - the frameworks section, an APG tablist with tabs `Vanilla JS`, `React` and `Angular`. Roving tabindex;
    Arrow keys, Home and End.
  - the footer, with npm links when `showNpm` is set.
- **Each tab panel** has two parts:
  - a demo: Vanilla is mounted in the page. React and Angular are lazy iframes created on first activation, with
    `src = ${site.base}react/` (and `angular/`), `loading="lazy"`, `title="React demo"` / `"Angular demo"` and
    class `demo-frame`;
  - a highlighted snippet with a copy button (`snippets.ts`). Highlighting uses DOM text nodes, never `innerHTML`
    with snippet strings.
- **Mirrored demo contents** (identical in Vanilla, React and Angular; the labels come from demo-kit):
  - toolbar: an example picker (a native `<select>` over `EXAMPLES`), a read-only checkbox, Undo and Redo buttons
    (disabled from `historyChange`), and the theme switch;
  - the editor in `split` mode with the real CodeMirror adapter (default `codeEditor`);
  - a `role="status"` line with `statusLine(...)`.
  - Choosing an example sets `format`, `variables` and `value`. Under the Q3 rule, a new store kind recreates the
    editor.
- **`scripts/build.mjs`** (survey §5):
  - `base` comes from `siteConfig(process.env)`;
  - remove `site/dist`, run `pnpm exec vite build`, and assert that `dist/react/index.html` exists;
  - write `site/dist/.nojekyll`.
  Task 7 adds the Angular step.
- **`scripts/check-dist.mjs`:**
  - require `dist/{index.html,react/index.html,.nojekyll}`;
  - every absolute `src`/`href` in each page starts with `base` and exists under `dist`, and relative ones exist
    (`index.html` for directories);
  - the landing bundle (`dist/assets/*.js`) contains the inlined `base` literal and the `react` iframe path
    segment.
  Task 7 extends it for `angular/`.

- [ ] **Step 1: Write the failing tests.**
  - `frameworks.test.ts`:
    - tablist ARIA: `aria-selected`, `aria-controls`, roving `tabindex`;
    - Arrow, Home and End keys;
    - the React iframe is created only on the first activation, with `src` `${base}react/` and the right title;
    - snippets have a copy button.
  - `vanilla-demo.test.ts` (the demo takes a `codeEditor` override, and the test passes `textareaAdapter()`):
    - choosing each example updates the status line;
    - read-only blocks typing;
    - the Undo button enables after typing and undoes;
    - Broken shows the banner.
  - `react-app.test.tsx` (StrictMode; `codeEditor` overridden by a test-only prop):
    - the same four behaviours as the Vanilla demo;
    - a `console.error` spy stays silent.
  - `theme.test.ts`:
    - the theme switch is an APG radio group;
    - choosing Dark writes `localStorage` and `data-theme`, and calls `setTheme('dark')` on the Vanilla editor;
    - a `storage` event from another frame applies the theme.
- [ ] **Step 2: Run `pnpm --filter @stack-weaver/site test`.** Expected: FAIL.
- [ ] **Step 3: Implement.** `site/react/app.tsx` uses `<ManifestEditor>` with props only (no imperative calls
  except Undo and Redo through `ref`).
- [ ] **Step 4: Run `pnpm -r build && pnpm --filter @stack-weaver/site test && pnpm --filter @stack-weaver/site typecheck && pnpm --filter @stack-weaver/site build:site && pnpm --filter @stack-weaver/site check`.**
  Expected: PASS. Run it again with `GITHUB_REPOSITORY=Constantine-24/stack-weaver` and check that it also passes
  with base `/stack-weaver/`.
- [ ] **Step 5: Commit** `feat(site): demo site with mirrored Vanilla and React demos`.

### Task 7: Angular `site-demo` project and the site's Angular tab

**Files:**
- Create: `packages/angular/projects/site-demo/{tsconfig.app.json,src/index.html,src/main.ts,src/styles.css,src/app/app.component.ts,src/app/app.component.spec.ts}`.
- Modify: `packages/angular/angular.json` (application project `site-demo`).
- Modify: `packages/angular/package.json` (`build` → `ng build stack-weaver-angular && ng build site-demo`).
- Modify: `site/scripts/build.mjs`, `site/scripts/check-dist.mjs`, `site/test/frameworks.test.ts`.

**Interfaces:**
- **`site-demo`:**
  - builder `@angular/build:application`, with styles `src/styles.css`. The stylesheet `@import`s
    `@stack-weaver/core/stack-weaver.css` and demo-kit's `theme.css` and `controls.css`;
  - budgets: initial 500 kB warn / 1 MB error (raise them only if CodeMirror's lazy chunk counts as initial, and
    record a ruling if so); `anyComponentStyle` 4 kB / 8 kB;
  - serve with `@angular/build:dev-server`;
  - it imports `@stack-weaver/angular` through the workspace `paths` (the built library).
- **The app** is the mirrored demo from Task 6 (same toolbar, labels, status line and theme switch), built with
  `SwManifestEditor`. It is zoneless (`provideZonelessChangeDetection()`).
- **`build.mjs`:** after Vite, run `pnpm --filter @stack-weaver/angular-workspace exec ng build site-demo
  --base-href ${base}angular/`. Assert that `packages/angular/dist/site-demo/browser/index.html` exists, then copy
  that `browser` directory to `site/dist/angular`.
- **`check-dist.mjs`:**
  - require `dist/angular/index.html`;
  - it must contain `<base href="${base}angular/">`;
  - its asset URLs resolve;
  - the landing bundle contains the `angular` segment.

- [ ] **Step 1: Write the failing tests.**
  - `app.component.spec.ts` covers the same four behaviours as `vanilla-demo.test.ts`, with `textareaAdapter()`
    injected through an input. Name the tests the same.
  - `frameworks.test.ts` adds `the Angular iframe is created only on first activation`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `pnpm -r build && pnpm --filter @stack-weaver/angular-workspace test && pnpm --filter @stack-weaver/site test && pnpm --filter @stack-weaver/site build:site && pnpm --filter @stack-weaver/site check`.**
  Run it with and without `GITHUB_REPOSITORY`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(site): Angular demo tab`.

### Task 8: Release prep

**Files:**
- Modify: `.changeset/config.json`, set `"fixed": [["@stack-weaver/core", "@stack-weaver/angular", "@stack-weaver/react"]]`.
- Delete: `.changeset/{initial-core,editor-ui,variables-rules,api-hardening,controller-signals}.md`.
- Create: `.changeset/first-release.md`.
- Modify: `packages/core/package.json` (`version` `0.0.0`, `homepage`).
- Modify: `scripts/pack-check.mjs` (PACKAGES).
- Modify: root `package.json` (scripts).
- Create: `.github/workflows/{ci,pages,release}.yml`, `.github/dependabot.yml` and `.github/PULL_REQUEST_TEMPLATE.md`.
- Create: `CONTRIBUTING.md`.
- Modify: root `README.md`.
- Modify: `docs/superpowers/notes/2026-10-30-plan-1-followups.md` (Plan 5 items done).
- Modify: the spec's "Packages and tooling" if a ruling changed it (Q10).

**Interfaces and values:**
- **`first-release.md`:**
  - front matter: `"@stack-weaver/core": minor`, `"@stack-weaver/react": minor`, `"@stack-weaver/angular": minor`;
  - body: "First public release." followed by one paragraph per package. Build them from the five folded changesets
    (feature lists only, without "Breaking" sections) and from the two wrapper READMEs.
- **`pack-check.mjs` PACKAGES** adds two entries:
  - `{ dir: 'packages/react', attw: ['--profile','esm-only'], required: ['dist/index.js','dist/index.d.ts'] }`;
  - `{ dir: 'packages/angular/projects/stack-weaver-angular', attw: ['--profile','esm-only'], required:
    ['fesm2022/stack-weaver-angular.mjs','types/stack-weaver-angular.d.ts'] }`.
  Update the header comment ("All three packages …").
- **Root scripts:**
  - add `"test:smoke": "pnpm -r test:smoke"`;
  - add `"build:site": "pnpm -r build && pnpm --filter @stack-weaver/site build:site && pnpm --filter @stack-weaver/site check"`;
  - keep `release` as it is (it already runs `check-entry` and `check-types`).
- **Workflows:** copy grid-master's `.github/workflows/{ci,pages,release}.yml` and `dependabot.yml` (survey §1),
  replacing `@dash-builder` with `@stack-weaver`, and:
  - CI adds a `Core graph checks` step after the build: `node packages/core/scripts/check-entry.mjs && node
    packages/core/scripts/check-types.mjs` (Q12);
  - the LICENSE parity loop covers `packages/core/LICENSE`, `packages/react/LICENSE` and
    `packages/angular/projects/stack-weaver-angular/LICENSE`;
  - the action pins are the same SHAs and versions as grid-master's;
  - dependabot keeps the angular, react and dev-tooling groups and ignores the same majors.
- **`CONTRIBUTING.md`** sections: Getting started, Project layout (table), Development loop, Demo site, Pull
  requests (including "A change to one wrapper comes with the same change in the other"; Conventional Commits),
  Releases (with "### First publish (maintainer, once)" and "### GitHub Pages (once)").
  - Text adapted from survey §7: `workspace:0.x` rather than `workspace:^`; the Angular package publishes from
    `publishConfig.directory`; the manual first publish, then npm trusted publishers; `pnpm changeset status
    --verbose`.
- **Root `README.md`** sections: Why stack-weaver? / Packages (table) / Installation (including the CodeMirror
  peers) / Quick start (### React, ### Angular, ### Vanilla JS / TS) / Documentation / Compatibility (table: core
  "Any evergreen browser (ES2022)"; react "React 19. Safe under `<StrictMode>` and server rendering."; angular
  "Angular 22, standalone. Works with zone.js and zoneless.") / Limitations (the spec's Non-goals) / Contributing /
  License.

- [ ] **Step 1: Make the config and version changes, then run `pnpm install` and `pnpm changeset status --verbose`.**
  Expected: all three packages at 0.1.0 (minor). If not, fix the version or config, not the expectation.
- [ ] **Step 2: Run `pnpm build && pnpm typecheck && pnpm test && pnpm test:smoke && node packages/core/scripts/check-entry.mjs && node packages/core/scripts/check-types.mjs && pnpm pack:check && pnpm build:site`.**
  Expected: all pass. `pack:check` prints ✓ for three packages and finds no `workspace:` range in any packed
  manifest.
- [ ] **Step 3: Validate the workflow YAML.** Expected: each file parses, for example with `node -e` and the `yaml`
  package from core.
- [ ] **Step 4: Update the follow-ups note.** Mark Plan 5 and R10 done, and move whatever this plan left out to
  "Parked".
- [ ] **Step 5: Commit** `chore(release): fixed version group, first-release changeset, pack:check for wrappers, CI/Pages/Release workflows, CONTRIBUTING`.

### Task 9: Browser verification (controller-run, chrome-devtools MCP)

This task is done by the controller, not dispatched: `pnpm build:site && pnpm --filter @stack-weaver/site preview`.
A defect found here becomes a fix commit (dispatched like a fix round) before the final review.

- [ ] **Step 1: Check each tab (Vanilla, React, Angular):**
  - a visual edit shows in the code pane, and typing in code updates the visual pane;
  - Broken shows the banner and "Jump to error";
  - Empty shows the recipes, and choosing one inserts YAML and fixes the format;
  - Compose with variables shows the Variables section and the "Use variable" toggle;
  - external variables work;
  - Undo and Redo buttons track history;
  - read-only blocks typing;
  - the status line updates;
  - the console has no errors.
- [ ] **Step 2: Lighthouse accessibility on the landing page and on `react/` and `angular/`, with the theme switch
  on Light and then on Dark.** Expected: 100 in each of the six runs. Fix and re-run any that fall short.
- [ ] **Step 3: Record the results** (scores and any fixes) in the ledger and the follow-ups note, and commit
  `docs: Plan 5 browser verification`.
