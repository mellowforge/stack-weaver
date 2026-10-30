# stack-weaver Plan 1: Headless Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo and the DOM-free core of `@stack-weaver/core`:
- a YAML document model that edits text without disturbing anything else;
- undo/redo history;
- a format registry with pinned Kubernetes 1.37.2 and compose-spec schemas, plus precompiled validators;
- curated guide data;
- the "what can be added here" engine;
- schema validation mapped to text ranges.

**Architecture:**
- **Text is the source of truth.** `parseText` wraps `yaml` v2 `parseAllDocuments`.
- **Edits splice text.** `applyEdit` splices the edited node's source range and never re-stringifies a whole document, so success criterion 2 holds by construction. Nodes it can't edit faithfully return `{ ok: false }`; these become read-only in visual later.
- **Schemas are generated from upstream** by repo scripts into per-kind lazy modules. Each module holds a JSON Schema (2020-12, `$defs`) and an ajv standalone validator.

**Tech Stack:** pnpm 12.11.2 workspace, Node 22, TypeScript ^7.0.2 (NodeNext), Vitest ^5.0.5, `yaml` ^2.9.1, `ajv` ^8.20.0 (`ajv/dist/2020`), `ajv-formats` ^3.0.1, Changesets ^3.0.3, `@arethetypeswrong/cli` ^0.18.5.

**Spec:** `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`. This is plan 1 of 4:
1. **Headless core** (this plan).
2. **UI:** visual, code and split views, the CodeMirror adapter, recipes.
3. **Compose variables and semantic rules.**
4. **Wrappers and release:** React and Angular wrappers, the site, publishing.

## Global Constraints

- **Packages:** `@stack-weaver/core` (this plan), and later `@stack-weaver/react` and `@stack-weaver/angular`. The root package is `stack-weaver-monorepo` (private). Every package starts at `0.1.0`, `"type": "module"`, ESM-only (`exports` entries hold only `types`/`import`), license MIT, author "Konstantin Penzin".
- **Tooling:** follows `/Users/konstantinpenzin/Developer/grid-master`. Copy its `tsconfig.base.json` exactly (ES2022, NodeNext, strict, isolatedModules, declaration). Also copy `.nvmrc` (`22`), its `pnpm-workspace.yaml` shape and `allowBuilds`, its `.changeset/config.json` with `fixed: [["@stack-weaver/core","@stack-weaver/angular","@stack-weaver/react"]]`, and its `scripts/pack-check.mjs`, with the packages list reduced to core for now.
- **No DOM in core for this plan.** Vitest runs with `environment: 'node'`.
- **Kubernetes:** pinned to **v1.37.2** (`dl.k8s.io/release/stable.txt` on 2026-10-30). Source: `kubernetes/kubernetes` at tag `v1.37.2`, `api/openapi-spec/v3/*.json`. Only GA group-versions are included; any group-version containing `alpha` or `beta` is skipped **[call]**.
- **Compose:** `compose-spec/compose-spec` at commit `3a4a6995e4a971f6173dff9130cb3e38e6738651`, `schema/compose-spec.json` (draft 2020-12).
- **Downloads and lockfile:** generators download into `.cache/` (gitignored) and record the URL and sha256 of every file in a committed `packages/core/schema-sources.lock.json`. Generated output goes in `packages/core/src/formats/*/generated/` and is gitignored. `pretest` and `prebuild` run the generators, which reuse the cache when the lockfile's sha256 values match.
- **Per-kind budget:** each chunk under **60 kB gzipped**. The core entry (`dist/index.js`) must not import or bundle any `generated/` file.
- **Edits never reformat** text outside the edited node's lines. Line endings (LF/CRLF), indentation style and comments are preserved.
- **Validation speed:** a 1,000-line document validates in **under 50 ms** with warm caches.
- Every public export gets TSDoc and is part of the public API.

## Review Focus

1. **CRLF files:** an edit to a `\r\n` file must insert `\r\n`, never a bare `\n` (Task 3 test `preserves CRLF`).
2. **Indentation style:** a new map entry or sequence item must copy its siblings' indentation, both 4-space maps and the non-indented `- ` sequence style, where items sit at the parent key's column (Task 3 tests `matches 4-space indent` and `matches non-indented sequences`).
3. **End-of-file edges:** a file with no trailing newline, with a trailing `...`, or holding only comments, still edits and appends documents correctly (Task 3 test `appends at EOF without trailing newline` and Task 2 test `comment-only text parses to zero docs`).
4. **Multibyte text:** emoji or CJK earlier in the file must not shift the edit position. Offsets are UTF-16 everywhere (Task 3 test `offsets after emoji`).
5. **Edits while the parse is broken:** `DocumentStore.edit` on a broken parse must refuse, and must not write against the stale `lastGood` text (Task 4 test `edit refuses while parse is broken`).

---

### Task 1: Monorepo and core package scaffold

**Files:**
- Create:
  - root: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `.gitignore`, `.changeset/config.json`, `.changeset/README.md`, `LICENSE`, `README.md`, `scripts/pack-check.mjs`;
  - core: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsconfig.build.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/README.md`, `packages/core/LICENSE`.
- Test: `packages/core/test/index.test.ts`

**Interfaces:**
- Produces: `export const VERSION: string` from `src/index.ts`, set to the package version `'0.1.0'`. Root scripts: `build`, `test`, `typecheck`, `pack:check`, `changeset`, `version-packages`, `release`, all identical to grid-master's.

- [ ] **Step 1:** Write the failing test `exports VERSION`: `expect(VERSION).toBe('0.1.0')`.
- [ ] **Step 2:** Run `pnpm install && pnpm --filter @stack-weaver/core test`. Expected: FAIL (module or export missing).
- [ ] **Step 3:** Create the scaffold. `.gitignore` = grid-master's plus `.cache/` and `packages/core/src/formats/*/generated/`. Core `package.json`:
  - `exports`: `"."`, `"./formats/kubernetes"`, `"./formats/compose"`, each `{types, import}` into `dist/`;
  - `sideEffects: false`;
  - `dependencies`: `yaml`, `ajv`, `ajv-formats`;
  - `scripts.build`: `tsc -p tsconfig.build.json && node scripts/copy-generated.mjs`.

  Leave `copy-generated.mjs` as a no-op until Task 6. Add `repository` and `homepage` pointing at `github.com/Constantine-24/stack-weaver`, mirroring dash-builder's fields.
- [ ] **Step 4:** Run `pnpm --filter @stack-weaver/core test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `chore: scaffold stack-weaver monorepo and core package`.

### Task 2: Parsing, node paths and the fixture corpus

**Files:**
- Create: `packages/core/src/document/types.ts`, `packages/core/src/document/parse.ts`, `packages/core/src/document/paths.ts`
- Create the corpus in `packages/core/test/fixtures/corpus/`. It needs at least 20 files covering:
  - **Kubernetes:** a multi-document web app (Deployment, Service, Ingress) with comments; flow maps such as `{ app: web }`; a block scalar ConfigMap (`|` and `>-`); an unknown CRD kind; 4-space indentation; non-indented sequences; a CRLF copy of the web app; a leading `---` with a trailing `...`; no trailing newline; a comment-only file; emoji and CJK values.
  - **Compose:** anchors with `<<:` merges, `x-` extension blocks, `${VAR}` and `${VAR:-x}` placeholders, a long-form `ports` list.
- Test: `packages/core/test/document/parse.test.ts`, `packages/core/test/document/paths.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type YamlPath = readonly (string | number)[];
  export interface NodeRef { doc: number; path: YamlPath }
  export interface TextChange { from: number; to: number; insert: string }
  export interface YamlProblem { message: string; from: number; to: number; line: number; col: number }
  export interface ParsedText {
    text: string; ok: boolean; docs: import('yaml').Document.Parsed[];
    lineCounter: import('yaml').LineCounter; errors: YamlProblem[]; eol: '\n' | '\r\n';
  }
  ```
- Produces: `parseText(text: string): ParsedText` in `parse.ts`:
  - uses `parseAllDocuments(text, { keepSourceTokens: true, lineCounter, prettyErrors: false })`;
  - `ok` means there are no errors in any document;
  - line and column are 1-based;
  - `eol` is the first line ending found, defaulting to `'\n'`.
- Produces, in `paths.ts`:
  - `getNode(p: ParsedText, ref: NodeRef): import('yaml').Node | undefined`, which does **not** follow aliases;
  - `getPairKey(p, ref): import('yaml').Scalar | undefined`, the key node of the pair holding `ref`;
  - `refAtOffset(p, offset: number): NodeRef | undefined`, the deepest node whose `range` contains `offset`;
  - `toLineCol(p, offset): { line: number; col: number }`.

- [ ] **Step 1:** Write the failing tests:
  - `multi-doc web app parses to 3 docs, ok`;
  - `comment-only text parses to zero docs, ok`;
  - `duplicate key yields ok=false with line/col`;
  - `detects CRLF eol`;
  - `getNode resolves ['spec','template','spec','containers',0,'image'] to the image scalar`;
  - `refAtOffset on the image value returns that path`;
  - `getNode on an alias returns the Alias node (not its target)`;
  - `every corpus file: parseText(text).text === text` (a guard against anyone regenerating text).
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/document`. Expected: FAIL.
- [ ] **Step 3:** Implement `parse.ts` and `paths.ts` with the signatures above.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): parse YAML text with node paths and fixture corpus`.

### Task 3: Text-splice edit engine

**Files:**
- Create: `packages/core/src/document/edit.ts`, `packages/core/src/document/diff.ts`, `packages/core/src/document/render.ts`
- Test: `packages/core/test/document/edit.test.ts`, `packages/core/test/document/edit.corpus.test.ts`, `packages/core/test/document/diff.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `parseText`, `getNode`, `getPairKey`.
- Produces:
  ```ts
  export type ScalarValue = string | number | boolean | null;
  export type EditOp =
    | { op: 'set'; at: NodeRef; value: ScalarValue }
    | { op: 'add'; at: NodeRef; key: string; value: unknown }   // at = block map
    | { op: 'push'; at: NodeRef; value: unknown }               // at = block seq
    | { op: 'delete'; at: NodeRef }                             // pair or seq item
    | { op: 'addDocument'; yaml: string };
  export type EditBlock = 'alias' | 'flow' | 'block-scalar' | 'not-found' | 'parse-error' | 'unsupported';
  export type EditResult = { ok: true; text: string; change: TextChange } | { ok: false; reason: EditBlock };
  export function applyEdit(p: ParsedText, op: EditOp): EditResult;
  export function canEdit(p: ParsedText, ref: NodeRef): true | EditBlock;
  export function diffText(a: string, b: string): TextChange;      // diff.ts
  export function renderValue(value: unknown, indent: number, eol: '\n' | '\r\n'): string; // render.ts
  ```

**Rules, the algorithm the tests pin:**
- **`set`:** replaces only `[node.range[0], node.range[1])`. The new source comes from `yaml`'s `stringify(value)` without its trailing newline. Quote it when a plain scalar would re-type it, for example the string `"8080"` or `"true"`. A comment after the value stays.
- **`add` and `push`:** insert after the last line of the parent collection. Indentation comes from the first existing child. For empty `{}` or `[]` parents, or `key:` with a null value, `add`/`push` instead replace the value with a block collection one level deeper, using 2 spaces. The block is rendered with `renderValue`.
- **`delete`:** removes whole lines from the start of the pair's or item's line to the end of its node, including its own trailing comment lines, up to the next sibling. If it was the only child, the parent becomes `{}` or `[]`.
- **`addDocument`:**
  - It appends `---` + eol + yaml.
  - It adds an eol before that if the file doesn't end with one.
  - If the file ends with `...` + eol, the new document goes after the `...` line.
- **Refusals:** a target inside a flow collection → `flow`; a target that is an alias or sits under an alias → `alias`; a target that is a block scalar with a non-default indentation indicator → `block-scalar`; `!p.ok` → `parse-error`.
- **`diffText`:** a single change made of the common prefix and common suffix.

- [ ] **Step 1:** Write the failing tests in `edit.test.ts`, each asserting the exact output text:
  - `set replaces image only`;
  - `set keeps trailing comment`;
  - `set quotes "8080" string`;
  - `add appends env entry`;
  - `add into empty map {}`;
  - `push into containers`;
  - `delete pair removes its comment lines`;
  - `delete last item leaves []`;
  - `addDocument after doc without trailing newline`;
  - `preserves CRLF`;
  - `matches 4-space indent`;
  - `matches non-indented sequences`;
  - `appends at EOF without trailing newline`;
  - `offsets after emoji`;
  - `refuses flow`;
  - `refuses alias`;
  - `refuses parse-error`.
- [ ] **Step 2:** Write the failing property tests in `edit.corpus.test.ts`:
  - **set:** for every corpus file and every editable scalar, `set` to a new value of the same type, then:
    - only the lines containing that scalar's range differ (line-diff the before and after text);
    - `parseText(result).ok` holds;
    - `getNode(...)` now returns the new value.
  - **delete:** for every pair, `delete` changes only lines inside that pair's line span.
  - **fallback ratio:** `canEdit` refusals stay under 5% of all scalar nodes across the corpus.
- [ ] **Step 3:** Run `pnpm --filter @stack-weaver/core test -- test/document/edit`. Expected: FAIL.
- [ ] **Step 4:** Implement `diff.ts`, `render.ts` and `edit.ts`.
- [ ] **Step 5:** Run the same command, plus `-- test/document/diff`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(core): text-splice edit engine with corpus round-trip tests`.

### Task 4: DocumentStore with shared undo/redo

**Files:**
- Create: `packages/core/src/document/store.ts`
- Test: `packages/core/test/document/store.test.ts`

**Interfaces:**
- Consumes: `parseText`, `applyEdit`, `diffText`.
- Produces:
  ```ts
  export type ChangeOrigin = 'visual' | 'code' | 'api' | 'history';
  export interface StoreEvent { text: string; change: TextChange; origin: ChangeOrigin; parsed: ParsedText }
  export interface StoreOptions { now?: () => number; groupMs?: number /* default 500 */; historyLimit?: number /* default 200 */ }
  export class DocumentStore {
    constructor(text: string, opts?: StoreOptions);
    get text(): string; get parsed(): ParsedText; get lastGood(): ParsedText;
    setText(text: string, origin: Exclude<ChangeOrigin, 'history'>): void; // no-op when equal
    edit(op: EditOp): EditResult;  // origin 'visual'
    undo(): boolean; redo(): boolean; get canUndo(): boolean; get canRedo(): boolean;
    subscribe(fn: (e: StoreEvent) => void): () => void;
  }
  ```
  - `lastGood` updates only when a parse succeeds.
  - Consecutive `'code'` changes within `groupMs` of each other merge into one history entry.
  - A `'visual'` edit is always its own entry.
  - A new change clears the redo stack.

- [ ] **Step 1:** Write the failing tests:
  - `setText equal is a no-op (no event)`;
  - `edit emits visual event with minimal change`;
  - `edit refuses while parse is broken` (returns `{ok:false, reason:'parse-error'}`, text unchanged);
  - `lastGood survives a broken parse`;
  - `code typing within 500ms groups into one undo`;
  - `visual edit is its own undo step`;
  - `undo/redo restore exact text and emit origin 'history'`;
  - `new change clears redo`;
  - `historyLimit drops oldest`.

  Use the injected `now` for the clock.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/document/store`. Expected: FAIL.
- [ ] **Step 3:** Implement `DocumentStore`. Store text snapshots plus the change for each entry.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): DocumentStore with grouped shared history`.

### Task 5: Format types, registry and guide merging

**Files:**
- Create: `packages/core/src/formats/types.ts`, `packages/core/src/formats/registry.ts`, `packages/core/src/formats/guide.ts`
- Test: `packages/core/test/formats/registry.test.ts`, `packages/core/test/formats/guide.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type JsonSchema = Record<string, unknown>;
  export interface SchemaError { instancePath: string; keyword: string; params: Record<string, unknown>; message?: string }
  export type ValidateFn = (data: unknown) => SchemaError[];       // [] = valid
  export interface SchemaBundle { id: string; schema: JsonSchema /* root, with $defs */; validate: ValidateFn }
  export interface KindEntry { id: string; apiVersion: string; kind: string; defName: string; description: string }
  export interface GuideField { label?: string; description?: string; recommended?: boolean; advanced?: boolean; order?: number; widget?: string; hidden?: boolean; example?: unknown }
  export interface Guide {
    groups: { id: string; label: string; order: number }[];
    kinds: Record<string /* "apps/v1/Deployment" */, { label: string; description: string; group: string; order?: number }>;
    fields: Record<string /* "<defName>#<property>" */, GuideField>;
  }
  export interface FormatDefinition {
    id: string; label: string; version: string; rootModel: 'documents' | 'mapping';
    detect(p: ParsedText): boolean;
    kinds(): readonly KindEntry[];                                      // [] for 'mapping'
    loadSchema(p: ParsedText, doc: number): Promise<SchemaBundle | undefined>; // undefined = unknown kind
    guide: Guide;
  }
  // registry.ts
  export function registerFormat(f: FormatDefinition): void;   // throws on duplicate id
  export function getFormat(id: string): FormatDefinition | undefined;
  export function detectFormat(p: ParsedText): FormatDefinition | undefined; // first match, registration order
  // guide.ts
  export function mergeGuide(base: Guide, override: Partial<Guide>): Guide; // deep merge; groups merged by id
  export function guideField(g: Guide, defName: string | undefined, prop: string): GuideField | undefined;
  ```

- [ ] **Step 1:** Write the failing tests:
  - `registerFormat rejects duplicate id`;
  - `detectFormat returns first matching`;
  - `mergeGuide overrides a field label but keeps recommended`;
  - `mergeGuide merges groups by id and keeps order`;
  - `guideField looks up "<def>#<prop>"`.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/formats`. Expected: FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): format registry and guide overlay types`.

### Task 6: Kubernetes schema generator and lazy kind loader

**Files:**
- Create: `packages/core/scripts/gen-kubernetes.mjs`, `packages/core/scripts/lib/normalize-k8s.mjs`, `packages/core/scripts/lib/emit.mjs`, `packages/core/scripts/copy-generated.mjs`, `packages/core/schema-sources.lock.json`, `packages/core/src/formats/kubernetes/loader.ts`
- Generated (gitignored) in `src/formats/kubernetes/generated/`:
  - `kinds.json` (`KindEntry[]`);
  - `loaders.ts` (`export const loaders: Record<string, () => Promise<{ schema: JsonSchema; validate: (d: unknown) => boolean & { errors?: unknown } }>>`, with one static `import('./kinds/<id>.js')` per kind);
  - `kinds/<id>.js`, holding `export const schema = …` plus the ajv standalone validator as `export const validate`;
  - `kinds/<id>.d.ts`.

  `<id>` is `<group or "core">_<version>_<Kind>`, for example `apps_v1_Deployment`.
- Test: `packages/core/test/formats/normalize-k8s.test.ts`, `packages/core/test/formats/kubernetes-loader.test.ts`

**Interfaces:**
- Produces:
  - `normalizeK8s(components: Record<string, JsonSchema>): Record<string, JsonSchema>` (the normalization rules below).
  - `collectReachable(defs, rootName): Record<string, JsonSchema>`.
  - `loadKubernetesKind(apiVersion: string, kind: string): Promise<SchemaBundle | undefined>` in `loader.ts`. It wraps the ajv errors into `SchemaError[]` and caches per id.
  - `kubernetesKinds(): readonly KindEntry[]`.

**Normalization rules:**
1. `#/components/schemas/X` becomes `#/$defs/X`.
2. `format: int-or-string` or `x-kubernetes-int-or-string: true` becomes `anyOf: [{type:'integer'},{type:'string'}]`, keeping `description`.
3. `io.k8s.apimachinery.pkg.api.resource.Quantity` becomes `anyOf: [{type:'string', pattern: '^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+|[numkMGTPE]i?|[KMGTPE]i)?$'}, {type:'number'}]`.
4. `nullable: true` adds `'null'` to `type`.
5. Drop every `x-kubernetes-*` key except `x-kubernetes-group-version-kind`.
6. For each kind root:
   - set `apiVersion: {const}` and `kind: {const}`;
   - add both to `required`;
   - set `metadata` to required.

**Kinds included:**
- definitions with exactly one `x-kubernetes-group-version-kind`;
- the kind doesn't end in `List`;
- the definition isn't under `io.k8s.apimachinery.pkg.apis.meta`;
- the group-version isn't alpha or beta.

**Generation and build behaviour:**
- **Ajv:** `new Ajv2020({ code: { source: true, esm: true }, strict: false, allErrors: true })` with `ajv-formats` added, plus no-op formats `int32`, `int64`, `double` and `byte`.
- **What the script does:**
  - downloads the file list for tag `v1.37.2` from the GitHub contents API, then each file, into `.cache/k8s/v1.37.2/`;
  - verifies or writes the sha256 values in the lockfile;
  - fails if any kind's gzipped `.js` is over 60 kB.
- **Build:** `copy-generated.mjs` copies `generated/**/*.{js,d.ts,json}` into `dist/formats/*/generated/`.
- **Scripts:** core `pretest` and `prebuild` run `node scripts/gen-kubernetes.mjs`.

- [ ] **Step 1:** Write the failing tests for `normalizeK8s` on small inline schemas:
  - `ref rewrite`;
  - `int-or-string`;
  - `quantity`;
  - `nullable`;
  - `kind root consts and required`;
  - `collectReachable includes PodSpec for Deployment`.
- [ ] **Step 2:** Write the failing loader tests, which need generated output:
  - `kinds include apps/v1 Deployment, v1 Service, networking.k8s.io/v1 Ingress, autoscaling/v2 HPA; exclude *List and v1beta1`;
  - `loadKubernetesKind('apps/v1','Deployment') validates the web-app fixture doc 0 with []`;
  - `replicas: "three" yields a SchemaError at /spec/replicas keyword type`;
  - `unknown kind returns undefined`.
- [ ] **Step 3:** Run `pnpm --filter @stack-weaver/core test -- test/formats`. Expected: FAIL.
- [ ] **Step 4:** Implement the generator, its libs, `copy-generated.mjs` and `loader.ts`. Run `node packages/core/scripts/gen-kubernetes.mjs`. Expected: the lockfile is written, and each kind prints its gzipped size, all under 60 kB.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(core): generate pinned Kubernetes 1.37.2 schemas and lazy validators`.

### Task 7: Compose schema generator and loader

**Files:**
- Create: `packages/core/scripts/gen-compose.mjs`, `packages/core/src/formats/compose/loader.ts`
- Generated (gitignored): `src/formats/compose/generated/compose.js` and `compose.d.ts` (`schema` and `validate`).
- Test: `packages/core/test/formats/compose-loader.test.ts`

**Interfaces:**
- Consumes: `emit.mjs` and the lockfile from Task 6.
- Produces: `loadComposeSchema(): Promise<SchemaBundle>`, cached.
- `pretest` and `prebuild` also run `gen-compose.mjs`.
- The schema is used unmodified, apart from inlining the remote `$ref`s if there are any.

- [ ] **Step 1:** Write the failing tests:
  - `compose fixture with anchors validates []`;
  - `services.web.ports: "abc" (invalid) yields an error`;
  - `unknown top-level key "foo" yields additionalProperties error`;
  - `x-variables top-level key is allowed`.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/formats/compose`. Expected: FAIL.
- [ ] **Step 3:** Implement the generator, pinned to commit `3a4a6995e4a971f6173dff9130cb3e38e6738651`, and the loader.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): pinned compose-spec schema and validator`.

### Task 8: Curated guides and the two format definitions

**Files:**
- Create: `packages/core/src/formats/kubernetes/guide.ts`, `packages/core/src/formats/kubernetes/index.ts`, `packages/core/src/formats/compose/guide.ts`, `packages/core/src/formats/compose/index.ts`
- Test: `packages/core/test/formats/guides.test.ts`, `packages/core/test/formats/detect.test.ts`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces `kubernetesFormat: FormatDefinition`:
  - `id: 'kubernetes'`, `version: '1.37.2'`, `rootModel: 'documents'`;
  - `detect`: every document has string `apiVersion` and `kind`;
  - `loadSchema`: reads `apiVersion`/`kind` from that document.
- Produces `composeFormat: FormatDefinition`:
  - `id: 'compose'`, `version` = the first 7 characters of the commit, `rootModel: 'mapping'`;
  - `detect`: a single document whose root map has at least one of `services`, `networks`, `volumes`, `configs`, `secrets`, `include`, and no `apiVersion`.
- These are exported from the subpaths `@stack-weaver/core/formats/kubernetes` and `…/formats/compose`.

**Kubernetes guide content:**
- **Groups:** `run` "Run your app", `expose` "Expose it", `configure` "Configure it", `scale` "Scale & protect", `storage` "Storage".
- **Kinds:** Deployment, StatefulSet, Job, CronJob (run); Service, Ingress (expose); ConfigMap, Secret (configure); HorizontalPodAutoscaler `autoscaling/v2` (scale); PersistentVolumeClaim (storage). Each has a one-line plain-language description, as in the wireframe picker.
- **Fields:**
  - `io.k8s.api.core.v1.Container#resources` and `#readinessProbe` and `#livenessProbe` are recommended;
  - `#ports`, `#env`, `#image` and `#name` are common;
  - everything else falls back to advanced.

**Compose guide content:** a group `services`, and fields for the service definition: `image`, `ports`, `environment`, `depends_on`, `volumes` and `healthcheck` (recommended).

- [ ] **Step 1:** Write the failing tests:
  - `every kubernetes guide kind exists in kubernetesKinds()`;
  - `every guide field key "<def>#<prop>" exists in some loaded kind's $defs[def].properties` (the drift guard for version bumps);
  - the same two checks for compose against the compose schema;
  - `detect: web-app fixture → kubernetes, compose fixture → compose, empty → neither`.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/formats`. Expected: FAIL.
- [ ] **Step 3:** Implement the guides and format definitions.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): curated guides and kubernetes/compose format definitions`.

### Task 9: Schema resolver and the "what can be added here" engine

**Files:**
- Create: `packages/core/src/engine/resolve.ts`, `packages/core/src/engine/addable.ts`, `packages/core/src/engine/catalog.ts`
- Test: `packages/core/test/engine/resolve.test.ts`, `packages/core/test/engine/addable.test.ts`, `packages/core/test/engine/catalog.test.ts`

**Interfaces:**
- Consumes: `SchemaBundle`, `Guide`, `guideField`, the format definitions.
- Produces:
  ```ts
  export interface ResolvedSchema { schema: JsonSchema; defName?: string; required: readonly string[]; description?: string }
  export function resolveAt(bundle: SchemaBundle, path: YamlPath, data: unknown): ResolvedSchema | undefined;
  export type Tier = 'recommended' | 'common' | 'advanced';
  export interface AddableItem {
    key: string | null;          // null = new sequence item
    label: string; description: string; tier: Tier; required: boolean;
    valueTemplate: unknown;      // guide.example ?? {} | [] | '' | 0 | false | null by schema type
  }
  export function addableAt(bundle: SchemaBundle, guide: Guide, path: YamlPath, data: unknown): AddableItem[];
  export interface CatalogGroup { id: string; label: string; kinds: (KindEntry & { label: string; description: string })[] }
  export function kindCatalog(format: FormatDefinition): { curated: CatalogGroup[]; all: KindEntry[] };
  ```

**Resolution rules:**
- follow `$ref` into `$defs`, recording `defName`;
- merge `allOf` members;
- for `anyOf`/`oneOf`, pick the first branch the current `data` at that path validates against structurally (by type), or else the first object branch;
- number segments take `items`;
- an unknown key takes `additionalProperties`, or `patternProperties` matched by regex;
- the result is `undefined` when nothing resolves.

**Ordering of `addableAt`:**
- required-and-missing first;
- then recommended → common → advanced, using guide `order` and then the property name;
- it excludes keys already present and keys the guide marks `hidden`;
- `label` defaults to the property name;
- `description` defaults to the first sentence of the schema `description`.

- [ ] **Step 1:** Write the failing tests:
  - `resolveAt Deployment containers[0] gives defName io.k8s.api.core.v1.Container`;
  - `resolveAt metadata.labels.app gives string via additionalProperties`;
  - `resolveAt targetPort gives int-or-string anyOf`;
  - `addableAt container (with name,image,ports,env present) starts with resources, readinessProbe, livenessProbe as recommended and excludes ports/env`;
  - `addableAt compose services.web lists healthcheck as recommended`;
  - `addableAt on a sequence returns one item with key null`;
  - `kindCatalog kubernetes: groups in order run, expose, configure, scale, storage; Service in expose`;
  - `kindCatalog all contains uncurated kinds like v1 ServiceAccount`.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core test -- test/engine`. Expected: FAIL.
- [ ] **Step 3:** Implement the three files.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(core): schema resolver and addable/catalog engine`.

### Task 10: Validation pipeline mapped to text ranges

**Files:**
- Create: `packages/core/src/validation/problems.ts`, `packages/core/src/validation/validate.ts`, `packages/core/src/validation/messages.ts`
- Test: `packages/core/test/validation/validate.test.ts`, `packages/core/test/validation/perf.test.ts`

**Interfaces:**
- Consumes: `ParsedText`, `getNode`, `getPairKey`, `toLineCol`, `FormatDefinition.loadSchema`.
- Produces:
  ```ts
  export type Severity = 'error' | 'warning' | 'info';
  export interface Problem {
    severity: Severity; source: 'yaml' | 'schema' | 'rule'; code: string; message: string;
    doc: number; path: YamlPath; from: number; to: number; line: number; col: number;
  }
  export function validateText(p: ParsedText, format: FormatDefinition): Promise<Problem[]>;
  export function schemaErrorsToProblems(p: ParsedText, doc: number, errors: SchemaError[]): Problem[];
  ```

**Mapping rules:**
- **YAML parse errors** → `source 'yaml'`, `code 'yaml.syntax'`. Schema validation is skipped while `!p.ok`.
- **Unknown kind** (`loadSchema` returns `undefined`) → one `info` with `code 'kind.unknown'` on the `kind` value: "Unknown kind “X” — edit in code".
- **From `instancePath` to a node:** `instancePath` is unescaped (`~1`, `~0`), and digit segments on sequences become numbers. If the node is found, use its `range[0]..range[1]`.
  - `required` → the parent pair's key range, message `Missing required field “<prop>”`.
  - `additionalProperties` → the extra key's range, message `Unknown field “<prop>”`.
- **Collapsing:** for the same path, keep the deepest error and drop `anyOf`/`oneOf` wrapper errors when a branch error exists.
- **Messages** live in `messages.ts` as a `Messages` record keyed by ajv keyword, so plan 2 can make them translatable:
  - type → `Must be a <type>`;
  - enum → `Must be one of: a, b`;
  - minimum and maximum → `Must be ≥ N` and `Must be ≤ N`;
  - pattern → `Has an invalid format`;
  - const → `Must be “X”`.

- [ ] **Step 1:** Write the failing tests:
  - `replicas: "three" gives an error at the scalar's exact from/to/line/col`;
  - `container without name gives Missing required field “name” on the containers[0] item`;
  - `CRD doc gives a single info kind.unknown and no errors`;
  - `broken YAML gives only yaml.syntax problems`;
  - `compose unknown top-level key gives Unknown field “foo”`;
  - `multi-doc: problem.doc indexes the right document`.
- [ ] **Step 2:** Write the failing perf test `1000-line doc validates under 50ms warm`:
  - build the input from 20 copies of the web-app Deployment, around 1,000 lines;
  - call once to warm up;
  - assert `performance.now()` delta is under 50 on the second call.
- [ ] **Step 3:** Run `pnpm --filter @stack-weaver/core test -- test/validation`. Expected: FAIL.
- [ ] **Step 4:** Implement the three files.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(core): schema validation pipeline with text-range problems`.

### Task 11: Public API surface and package checks

**Files:**
- Modify: `packages/core/src/index.ts`, `scripts/pack-check.mjs`
- Create: `packages/core/scripts/check-entry.mjs`, `.changeset/initial-core.md`
- Test: `packages/core/test/index.test.ts` (extend)

**Interfaces:**
- **Main entry exports:** `VERSION`, all types from Tasks 2–5, 9 and 10, plus `parseText`, `getNode`, `refAtOffset`, `toLineCol`, `applyEdit`, `canEdit`, `diffText`, `DocumentStore`, `registerFormat`, `getFormat`, `detectFormat`, `mergeGuide`, `guideField`, `resolveAt`, `addableAt`, `kindCatalog`, `validateText`.
- **Subpath exports:** `kubernetesFormat`, `loadKubernetesKind`, `kubernetesKinds` from `./formats/kubernetes`; `composeFormat`, `loadComposeSchema` from `./formats/compose`.
- **No auto-registration:** the formats are not registered automatically. Hosts call `registerFormat(kubernetesFormat)`. Plan 2's `createManifestEditor` will register the defaults lazily.

- [ ] **Step 1:** Extend the test:
  - `main entry exports the documented names`;
  - `main entry module graph has no generated/ import`. Read `dist/index.js` and its static imports recursively, after `pnpm build`.
- [ ] **Step 2:** Run `pnpm --filter @stack-weaver/core build && pnpm --filter @stack-weaver/core test -- test/index`. Expected: FAIL.
- [ ] **Step 3:** Implement the exports.
  - `check-entry.mjs` walks the static imports of `dist/index.js`, fails on any `generated/` path, and prints the gzipped size of the entry graph.
  - In `pack-check.mjs`, set core's `required` to `dist/index.js`, `dist/index.d.ts`, `dist/formats/kubernetes/index.js` and `dist/formats/compose/index.js`.
  - Add the changeset "Initial headless core".
- [ ] **Step 4:** Run `pnpm build && pnpm test && pnpm pack:check && node packages/core/scripts/check-entry.mjs`. Expected: all pass; the entry has no generated imports.
- [ ] **Step 5:** Commit `feat(core): public API surface, subpath exports and package checks`.

---

## Spec coverage in this plan, and what's deferred

- **Covered here:**
  - the single document model and text splicing (the round-trip guarantee);
  - read-only reasons for aliases, flow collections and odd block scalars;
  - shared undo/redo;
  - the format registry and detection;
  - pinned schemas, lazy per-kind chunks, precompiled validators, the 60 kB budget;
  - the guide overlay with its fallback;
  - the addable engine and catalog;
  - YAML and schema validation with ranges;
  - the 50 ms budget;
  - unknown kinds kept with an info problem.
- **Plan 2 (UI):**
  - `createManifestEditor`, visual mode, widgets including Secret base64 handling;
  - the outline, the add-here slot, the picker;
  - the CodeMirror adapter (completion from `addableAt`, with `boost` and `section`);
  - split sync with the 100 ms reparse debounce, the broken-YAML banner;
  - recipes, `--sw-*` theming, messages and i18n, accessibility.
- **Plan 3:** the compose `VariableStore` (`x-variables` and external), placeholder substitution in validation, the 5 semantic rules, quick fixes.
- **Plan 4:** the React and Angular wrappers, the mirrored `site/` demos with demo-kit, Lighthouse, release CI and trusted publishing.
