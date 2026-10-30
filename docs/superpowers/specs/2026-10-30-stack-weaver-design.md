# stack-weaver: design spec (brainstorm output)

> **Name [user]:** `stack-weaver`, published as `@stack-weaver/{core,react,angular}`. The working name
> "kube-composer" is dropped because an existing open-source "Kube Composer" (a visual Kubernetes YAML
> generator) already uses it. The local folder is still `kube-composer/`; renaming it is the builder's call.
>
> **What approving this means:** approving the *design*, nothing else. The next steps after approval are:
> 1. `git init` the empty `kube-composer/` folder;
> 2. copy this spec into it and commit it;
> 3. run `superpowers:writing-plans` to produce the implementation plan.
>
> No `pnpm init`, no installed dependencies and no scaffolding until that plan is approved.
>
> This is a **design spec**, not an implementation plan. Once it's approved, it gets copied to
> `docs/superpowers/specs/2026-10-30-stack-weaver-design.md` in the repo (which is empty right now), and
> `superpowers:writing-plans` produces the implementation plan. Nothing gets scaffolded before that.
>
> Wireframes, with the direction approved by the user: https://www.figma.com/design/ed7dBRPBVrj8TDsSqcvQ79
> (1 Visual · 2 Split · 2b Split with invalid YAML · 3 Code)

Marking: **[user]** means the user decided it. **[call]** means my default, open to override.

## Context / intent

The user previously built a configuration editor as a **wizard**. It was a Dockerfile editor inside an
app-description JSON, and they consider it "a total disaster" because:
- it forced users through linear, hardcoded steps;
- it covered too little of the format;
- it was hard to extend, since each new field needed hand-written UI;
- no code was ever visible.

The one part worth keeping is **typed, reusable variables**.

stack-weaver is a **public npm package** that edits deployment manifests visually and as code. It
targets app developers who are new to Kubernetes, and end users of platforms that embed the editor
**[user]**. The YAML is always the source of truth and is always reachable.

## Goals

1. **Three modes [user]:** Visual, Code and Split. An edit in either pane shows up in the other immediately.
2. **Root plus sections [user]:** a document root that sections are added to. At every point it's obvious
   what can be added *there*.
3. **Two formats in v1 [user]:** Kubernetes manifests, and docker-compose.
4. **Schema-driven [user]:** the supported schema version is pinned and declared, and new
   formats, versions and kinds can be added later as *data*, not UI code.
5. **Validation in the UI [user]** against the schema, shown inline in both panes.
6. **Typed variables for compose [user]:** name, type and default. The output keeps `${VAR}`
   placeholders, which are resolved later at deploy time, outside the editor. **Kubernetes has no
   variables [user]**: shared values belong in ConfigMaps and Secrets.
7. **Starter recipes [user]:** an empty editor shows recipe cards (for example "Web app"), plus "Start blank".
8. **Packages [user]:** a vanilla core with React and Angular wrappers, following the conventions of the
   user's `treekit` and `grid-master` (`@dash-builder/*`) repos.

## Non-goals (v1) [user]

- No connection to a cluster: no apply or dry-run, no live state, no fetching schemas from a cluster.
- No multi-file projects. The editor takes one YAML document string in and gives one out (a `.env`
  file plus compose is out, and so is a folder of manifests).
- No CRD or custom resource schemas. Unknown kinds are kept as-is and can only be edited in code (see below).
- No Helm or Kustomize, whether templates, `values.yaml` or `kustomization.yaml`.
- No Dockerfile editing **[call]**: it isn't YAML and has no schema, so it doesn't fit this core.

## Anti-goals (a failure even if it works)

- The editor turns into a wizard: forced order, steps, or a modal "next" flow. Recipes insert YAML.
  They never ask a sequence of questions.
- The editor hardcodes per-field UI. Any field or kind added without touching the schema or guide data
  counts as a regression of the old tool's failure.
- The editor silently rewrites the user's YAML: dropping comments, reordering keys, losing
  unknown fields, or reformatting lines nobody touched.
- The editor overwrites what the user typed in code because the visual side was out of date.

## Success criteria [call]

1. An app developer who has never written a manifest can produce a valid Deployment, Service and
   Ingress (or a compose web app with a database) entirely in Visual mode.
2. Pasting any valid manifest and changing nothing returns **byte-identical** output. A visual edit
   changes only the lines belonging to the edited node, plus any lines it necessarily adds.
3. Adding a field, kind or schema version is a data change only, meaning schema plus guide overlay.
4. The vanilla, React and Angular wrappers behave identically and are shown side by side in mirrored demos.

---

## Architecture

### Packages and tooling [call: follow dash-builder, the newer of the two reference repos]

- pnpm monorepo publishing `@stack-weaver/core`, `@stack-weaver/react` (React 19) and
  `@stack-weaver/angular` (Angular 22: standalone, signals, zoneless-safe).
- **Package details:**
  - ESM-only, TypeScript, Vitest with happy-dom.
  - Changesets with the three packages `fixed` together; wrappers use `workspace:0.x` peers.
  - `pack:check` (attw), npm trusted publishing.
  - Angular builds with ng-packagr.
- **Demo and docs:** a `site/` with Vanilla, React and Angular tabs, plus a private `demo-kit` for shared
  fixtures and recipes.
- **Inherited rules:** wrappers contain only wiring; every export, CSS class and CSS variable is public API;
  WAI-ARIA APG patterns and WCAG 2.2 AA; Lighthouse a11y = 100; light and dark themes through `--sw-*`
  CSS variables; core ships `stack-weaver.css`.
- **Rendering:** unlike treekit, the core **renders its own DOM** (hand-written, like dash-builder),
  because the visual editor *is* the product.
- Unlike dash-builder, the core has runtime dependencies (`yaml`, `ajv`, CodeMirror). Format data is
  **lazy-loaded** through subpath imports, so the core entry stays small.

### One document model (the core of the sync)

- **Source of truth:** the YAML **text**. The core keeps the text plus the last successful parse, using
  `yaml` v2 `parseAllDocuments` with `keepSourceTokens` and a `LineCounter`. (I confirmed these through
  context7. `Document.toString()` throws if a doc has errors, which is one reason the last good parse is kept.)
- **Code → visual:** each text change is re-parsed (debounced, around 100 ms **[call]**).
  - If the parse succeeds, the visual pane re-renders, with nodes addressed by **stable YAML path**
    (`[docIndex, 'spec', 'template', 'spec', 'containers', 0]`), so selection and focus survive.
  - If the parse fails, the visual pane keeps the **last valid state, read-only**, with a banner and a
    "Jump to error" link (frame 2b). It never writes text while the parse is broken.
- **Visual → code:** the edit mutates the document (`setIn`/`addIn`/`deleteIn`) and the result is turned
  back into text. Only the **minimal text diff** is applied to the code editor, so caret, scroll and folds survive.
- **Top technical risk (spike first):** stringifying the whole document may reformat parts nobody touched.
  - **Acceptance bar:** success criterion 2, measured over a fixture corpus.
  - **Fallback:** edits at the source-token level using `yaml`'s CST helpers (for example
    `CST.setScalarValue`), splicing only the edited node's source range.
- **Undo/redo:** a single history owned by the core and shared by both views. Typing bursts are grouped.
  The code editor's own history is disabled, and Ctrl/Cmd+Z goes to the core.
- **YAML anchors, aliases and merge keys (`<<:`)**, which are common in compose **[call]**:
  - Nodes reached through an alias are shown in visual with a "shared via &anchor, edit in code" note.
    They're read-only there.
  - The anchor's definition stays editable in visual.

### Formats as data: the registry

```ts
registerFormat({
  id: 'kubernetes' | 'compose' | string,
  detect(text, parsed): boolean,     // k8s: apiVersion+kind; compose: services/top-level compose keys
  version: '1.36',                   // declared + shown in the UI badge
  schema,                            // JSON Schema (per kind for k8s)
  validators?,                       // precompiled (see Validation)
  guide,                             // guide overlay (below)
  recipes,                           // starter recipes for this format
  rules?,                            // semantic lint rules
  rootModel: 'documents' | 'mapping',
})
```

- **Root model:**
  - **Kubernetes:** the root is an ordered list of `---` documents. Each document is a top-level
    section chosen by `apiVersion`/`kind`.
  - **Compose:** the root is a single mapping with the sections `services`, `networks`, `volumes`,
    `configs`, `secrets` and **Variables**.
  - The same root-and-sections interface is used for both.
- **Format choice:** the host passes `format`, or `'auto'` detects it from the initial text. An empty document
  with `'auto'` shows recipes from every registered format.
- **Unknown kinds:** kinds with no schema (CRDs) are kept byte-for-byte. They appear as an outline card
  that says "Unknown kind, edit in code". Fields the schema doesn't know inside known kinds are kept too,
  and shown read-only in visual.
- **Pinned versions [call]:**
  - **Kubernetes:** the *latest stable minor at implementation time*, pinned exactly. As of a mid-2026
    search that's 1.36.x; 1.37 was in alpha, so check before pinning. 1.34, which the wireframe badge
    shows, reached end of life on 2026-10-27, so it must not be used.
    - The schema is generated by a repo script from the upstream Kubernetes OpenAPI v3 spec
      (`kubernetes/kubernetes` `api/openapi-spec/v3`) rather than a third-party mirror. The script is
      published, so more versions can be generated.
    - v1 bundles **one** Kubernetes version. Others can be registered and chosen with `schemaVersion`.
  - **Compose:** `schema/compose-spec.json` from the `compose-spec/compose-spec` repo, pinned to a commit.
  - Both are shipped as lazy subpaths: `@stack-weaver/core/formats/kubernetes` and `…/formats/compose`.

### Guide overlay: curation as data, a first-class part of the design

JSON Schema provides coverage but not friendliness. The overlay is per-format data that supplies
everything the wireframes show that a schema can't:

```ts
type Guide = {
  groups: { id: string; label: string; order: number }[];          // "Run your app", "Expose it", …
  kinds: Record<string, { label; description; group; order? }>;      // picker cards
  fields: Record<string /* "io.k8s.api.core.v1.Container#resources" */, {
    label?; description?; recommended?: boolean; advanced?: boolean;
    order?: number; widget?: string; hidden?: boolean; example?: unknown;
  }>;
};
```

- Field entries are keyed by **schema definition and property**, so one entry applies wherever that definition
  is reused (a Pod template inside a Deployment, a Job, a CronJob, and so on).
- **Fallback for anything not curated:** the first sentence of the schema's `description`, listed under
  "advanced". This gives full coverage without curating everything.
- Hosts can **deep-merge** their own overlay (rename, hide, mark recommended, translate).
- v1 curation scope **[call]**:
  - **Kubernetes:** Deployment, StatefulSet, Job, CronJob, Service, Ingress, ConfigMap, Secret,
    HorizontalPodAutoscaler, PersistentVolumeClaim and their common fields.
  - **Compose:** services, networks, volumes, configs and secrets, with their common fields.
  - Every other built-in kind still works through the schema fallback.

### The "what can be added here" engine (one engine, three consumers)

- **What it does:** given a YAML path, it finds the matching schema node. It handles `$ref`, `allOf`,
  `oneOf`/`anyOf`, `additionalProperties`, and Kubernetes `x-kubernetes-*` extensions such as int-or-string.
- **What it returns:** the properties and items that can be added and aren't present yet, ranked by the guide
  (★ recommended → common → advanced).
- **It feeds:**
  1. the visual **"+ Add to …" slot** and the outline's "+ add to…" rows (frame 1);
  2. the **Add resource picker**, grouped by intent;
  3. **code-mode completion**. CodeMirror 6's `Completion` supports `boost` and `section`, which map directly to
     recommended and group (confirmed through context7).
- Hover docs and the breadcrumb in code mode come from the same path resolution.

### Visual mode

As drawn in frame 1:
- **Left:** a document outline that follows the APG Tree pattern.
- **Centre:** the selected section's editor, with required fields marked, inline errors, "remove section",
  and a dashed **add-here slot** at the end of each section that can hold more.
- **Root:** "+ Add resource" opens the picker.

**Field widgets** are picked by schema type, format or guide `widget`, from a registry that hosts can extend:
- string, number, boolean, enum;
- int-or-string, and Kubernetes quantity (`500m`, `1Gi`);
- key-value maps (labels, annotations);
- lists of objects;
- a reference picker (`secretKeyRef`/`configMapKeyRef`, which suggests ConfigMaps and Secrets in the same
  document **[call]**).

**Secrets [call]:** values under `data` are shown decoded and written back base64-encoded. New entries go under
`stringData`.

### Code mode: an adapter interface, CodeMirror 6 by default [call]

- The core defines a `CodeEditorAdapter` (mount, apply a text change, read selection and reveal a range,
  diagnostics, completion source, hover, read-only, theme).
- **v1 ships a CodeMirror 6 adapter**, `@stack-weaver/core/editors/codemirror`, with CodeMirror packages
  as peer dependencies.
- **Why not Monaco as the default:**
  - Monaco adds several MB.
  - It needs worker and loader setup that is painful in Angular and SSR builds.
  - Its biggest advantage, schema completion through monaco-yaml, is already covered by the shared engine above.
- **Monaco adapter [user]:** a fast-follow in a v1.x release, behind the same public adapter interface.
  It's out of v1.

### Validation pipeline

1. **YAML parse errors**, with positions from the `yaml` package.
2. **Schema validation** with ajv.
   - Built-in formats ship validators **precompiled at build time** (ajv standalone code). This avoids
     `new Function`, which some sites' CSP blocks, and avoids compile cost at runtime.
   - Schemas a host registers itself are compiled at runtime, with the CSP caveat documented.
3. **Semantic rules**, as format plugins. v1 includes about 5 **[call]**:
   - a Service selector that matches no workload's labels;
   - a Deployment's `selector` that doesn't match its template labels;
   - a missing `resources` (warning);
   - a `targetPort` name that doesn't exist;
   - an undeclared compose `${VAR}`.

Errors are mapped from the failing schema path to YAML node source ranges to line and column. Each problem
has a severity, a message, a path, a range and an optional quick fix. Problems show inline in both panes,
in the problems panel (frame 3) and in the top-bar count. Each one links to the other view.

### Compose variables

- **Declaration:** `{ name, type: 'string' | 'number' | 'boolean' | 'port' | 'enum', enumValues?, default?, description? }` **[call on types]**.
- **Where they can be used:** any scalar value, since compose interpolates everywhere. The visual
  widget's "use variable" toggle lists only variables whose type fits the field.
- **Output:** always keeps the `${VAR}` placeholder. The editor never resolves values into the text.
  - The editor writes **bare `${VAR}`** **[call]**. Defaults live only in the declaration, so changing a
    default never leaves stale copies in the YAML.
  - Inline defaults written by hand (`${VAR:-x}`) are kept as-is.
- **Validation:**
  - Each placeholder is replaced by its declared default (or inline default) before schema checks.
  - A placeholder with no default is checked by its declared type only.
  - A hand-written inline default that differs from the declared default is a warning.
  - A placeholder that was never declared is a warning, with a "Declare variable" quick fix.
- **Storage is pluggable [user]**, through a `VariableStore` interface with two built-in implementations
  chosen by the host:
  - `x-variables`: a top-level `x-variables:` block in the compose file. Compose ignores keys that start
    with `x-`, so the file stays valid.
  - `external`: the host passes `variables` in and receives `onVariablesChange`, like the old app JSON.

### Starter recipes [user]

- **Shape:** `{ id, format, title, description, yaml }`. Hosts can add or replace recipes.
- **Built-in recipes [call]:**
  - Kubernetes: Web app (Deployment, Service, Ingress), Worker, Scheduled job, Config (ConfigMap and Secret).
  - Compose: Web app, App + Postgres, App + Redis.
- **What picking one does:** it inserts valid YAML with sample values and puts focus on the first field that
  still needs a real value. There's no question flow (see anti-goals).

### Host API (in the style of dash-builder) [call]

```ts
const editor = createManifestEditor(el, {
  format: 'kubernetes' | 'compose' | 'auto',
  value?: string,  mode?: 'visual' | 'split' | 'code',
  readOnly?: boolean,  theme?: 'light' | 'dark' | 'auto',
  codeEditor?: CodeEditorAdapter,          // default: CodeMirror adapter, loaded on demand
  formats?: FormatDefinition[],  recipes?: Recipe[],
  guide?: Record<formatId, GuideOverride>, // per-format overrides, merged over the format's guide
  variables?: { store: 'x-variables' } | { store: 'external'; value: VariableDecl[] },  // Plan 3
  widgets?: WidgetRegistry,
  messages?: { ui?: Partial<UiMessages>; schema?: Partial<SchemaMessages> },  // i18n
  onChange?(value: string, meta: { origin: ChangeOrigin }): void,  // 'visual' | 'code' | 'api' | 'history'
  onProblemsChange?(problems: Problem[]): void,
  onModeChange?(mode): void,  onVariablesChange?(decls): void,  // onVariablesChange: Plan 3
});
editor.getValue(); editor.setValue(text); editor.getMode(); editor.setMode(m); editor.getProblems();
editor.setReadOnly(b); editor.undo(); editor.redo(); editor.reveal(ref: NodeRef);
editor.ready; /* Promise<void>: the code editor and the first schema are loaded */ editor.destroy();
```

- **Plan 2 rulings that change the text above:**
  - `GuideField.tier` (`'recommended' | 'advanced'`) replaces the two booleans `recommended` and `advanced`.
  - `GuideField.options` gives suggested values. Upstream Kubernetes schemas have no enums for fields such as
    `restartPolicy`, so the guide supplies the list, and the widget suggests it without restricting input.
  - `WidgetFactory.managesKeys` says a mapping widget adds, shows and removes its own keys (the Secret `data`
    widget). The section then shows no "Add key", and the outline does not list the mapping as a section.
  - Recipes are offered only for an **empty document**. Once there is text, the "Start from a template" cards go away.
  - `variables` and `onVariablesChange` are not built yet: they stay listed here for Plan 3.
- **CSS tokens** (custom properties on `.sw-editor`, all public API): `--sw-bg`, `--sw-fg`, `--sw-muted`,
  `--sw-border` (decorative dividers and the editor frame), `--sw-control-border` (the border of an input, select,
  textarea or button, at least 3:1 against `--sw-bg`), `--sw-accent`, `--sw-on-accent`, `--sw-error`,
  `--sw-warning`, `--sw-info`, `--sw-focus` (at least 3:1), `--sw-radius`, `--sw-gap`, `--sw-font`, `--sw-mono`.
  The optional `--sw-selection` and `--sw-active-line` style the code pane. The dark theme is
  `data-sw-theme='dark'`, which the editor sets from the `theme` option.

- **Keystroke and controlled-value contract:** `onChange` fires on every committed change, synchronously.
  `setValue` is a **no-op if the text equals the current text**. A different text is treated as an external
  replace, applied as a minimal diff so the caret survives. This prevents the classic controlled-input
  caret jump and feedback loop.
- **React:** `<ManifestEditor value | defaultValue onChange mode onModeChange … ref>`, where `ref` exposes
  the controller.
- **Angular:** `<sw-manifest-editor [(value)] [(mode)] (problemsChange) …>` using `model()`. The core runs
  outside the Angular zone (`runOutsideAngular`), and only outputs re-enter it.

## Decisions from the builder check [call unless marked]

- **Lazy chunks and validators:**
  - Every built-in kind gets a validator **precompiled at build time** with ajv standalone, so
    runtime compilation (and its CSP problem) applies only to schemas a host registers.
  - Schemas and validators are split **per kind** into lazy chunks, behind a small kind index.
  - **Budgets:** under ~60 kB gzipped per curated-kind chunk. The core entry contains no format data.
  - If a chunk goes over budget, split it further by shared definition groups. Don't drop the strict
    validation.
- **Round-trip fallback rule:** sometimes neither full stringify nor CST splicing can edit a node faithfully,
  for example flow collections, block scalars with odd indentation, or comments inside the node.
  - That node becomes **read-only in visual** with "edit in code" (the same treatment as aliases), and never
    gets normalized.
  - Success criterion 2 is enforced over the fixture corpus. Read-only fallbacks must stay under 5% of the
    editable nodes in the corpus.
- **Ingress stays in the "Web app" recipe:** Ingress is still core and GA. Gateway API is a CRD (out of
  scope), so it's left for a future optional format pack.

## Open questions for the user

- None. Name and Monaco timing are settled above.

## Left to the builder

- Internal module layout, debounce values, widget visuals within the wireframe direction, test-file structure.
- Exact guide texts and recipe contents, within the scope above.
- Whether validation runs in a Web Worker. Required budget: a 1,000-line document validates in under 50 ms on the main thread, or it goes to a worker.

## Verification

- **Round-trip property tests** over a fixture corpus (upstream Kubernetes examples and compose samples, including comments,
  anchors, unknown fields, several documents):
  - parse → stringify without edits is byte-identical;
  - each visual edit changes only the lines it should.
- **Schema fixtures:** valid and invalid manifests per curated kind, with exact problem paths and ranges.
- **Engine tests:** "what can be added" for representative paths (container, pod spec, compose service).
- **Variables:** substitution and validation, both stores, quick fixes.
- **Adapter contract tests** run against the CodeMirror adapter.
- **Wrapper tests:** React and Angular, including a render test with no manual `detectChanges()`/`act()`
  (a lesson from treekit), and StrictMode.
- **Mirrored demos** for vanilla, React and Angular in `site/`, checked by hand with chrome-devtools MCP
  (sync, broken-YAML banner, recipes, both formats). Lighthouse a11y = 100 in light and dark themes.
- **Release checks:** `pnpm build && pnpm test && pnpm pack:check`, plus a bundle-size check that the
  core entry contains no format data.
