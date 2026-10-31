# @stack-weaver/core

Framework-agnostic core of stack-weaver, a schema-driven editor for Kubernetes and docker-compose YAML.

## Install

```sh
pnpm add @stack-weaver/core
```

The package is ESM-only (`"type": "module"`): use `import`, not `require`.

## Formats are opt-in

The main entry has no schemas. Import a format from its subpath and register it, so only the
formats you use are bundled (each Kubernetes kind's schema is a lazy chunk on top of that):

```ts
import { detectFormat, parseText, registerFormat, validateText } from '@stack-weaver/core';
import { kubernetesFormat } from '@stack-weaver/core/formats/kubernetes';
import { composeFormat } from '@stack-weaver/core/formats/compose';

registerFormat(kubernetesFormat);
registerFormat(composeFormat);

const parsed = parseText(text);
const format = detectFormat(parsed);
const problems = format ? await validateText(parsed, format) : [];
```

`ParsedText` is an opaque handle: its public fields are `text`, `ok`, `docCount`, `errors`, `warnings` and `eol`
(all readonly), and no `yaml` type appears in the public API. Read a document with `toData(parsed, doc)` or
`describeNode(parsed, ref)`; `refAtOffset` and `toLineCol` map between offsets and nodes. Pass a `ParsedText` only as
`parseText` returned it: a copy or look-alike makes the reading functions throw a `TypeError`. The handle and its
`errors` and `warnings` arrays are frozen.

Edits go through `applyEdit(parsed, op)`, which returns an `EditResult` (the new text, the change, the `parsed` of the
new text and the created node's `at`) or a refusal (`EditRefusal`). `DocumentStore` holds the text and one undo
history: `store.transact(ops, { group? })` applies several operations as one `'visual'` change, one undo step and one
event (the first refusal is returned and nothing changes; `group` applies to a single op only and is ignored for
several, whose step never merges); `store.reset(text)` replaces the text as an `'api'` change and clears the history;
`store.clearHistory()` empties undo and redo. `store.subscribe` reports text changes only: `clearHistory()`, and
`reset` to the current text, change `canUndo` / `canRedo` without an event. `applyEdit` and `canEdit` never throw: a
look-alike `ParsedText` or a malformed operation is refused as `unsupported`, and an unexpected internal failure is
refused the same way and logged with `console.error`.

### Writing a format

A `FormatDefinition` sees plain data, never `yaml` nodes:

- `detect(input)` receives `DetectInput`, `{ docs }`: `toData` of each document (`undefined` when a document is empty
  or cannot be built).
- `loadSchema(data)` receives one document's data and returns its `SchemaBundle` (or `undefined`). Choose the schema
  from the document-shape keys only (`apiVersion` and `kind` for a `'documents'` format): the "Add resource" picker
  calls it with a `{ apiVersion, kind }` stub to build a new document.
- A rule's `check(input)` receives `locate(doc, path, at?)`, which returns the `TextRange` of the node at `path`
  (its key with `at: 'key'`), or `undefined`, so a finding can be ranged without `yaml`.
- `guide` carries presentation data (see [Widgets](#widgets)); `variables` (`FormatVariables`) and `rules` are optional.

A rule's `id` must not be `'failed'`: a rule that throws reports `rule.failed` (a rule with that id gets one
`console.warn`). `registerFormat` does not freeze what you pass in (that would change your object); the built-in
formats are frozen.

`registerFormat`, the root `getFormat(id)` and `detectFormat(parsed)` with no list use a global registry for headless
use. The editor does not read it: give it your formats through the `formats` option. (The controller's
`getFormat()` is a different thing: the editor's format option, below.)

## The editor

`createManifestEditor` mounts a Visual, Split or Code editor over one shared document model: an edit in
either pane shows up in the other, and undo and redo span both. Import the stylesheet once:

```ts
import '@stack-weaver/core/stack-weaver.css';
import { createManifestEditor } from '@stack-weaver/core';

const editor = createManifestEditor(document.getElementById('editor')!, {
  format: 'auto', // 'kubernetes' | 'compose' | 'auto'
  value: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n',
  mode: 'split', // 'visual' | 'split' | 'code'
  onChange: (value, { origin }) => console.log(origin, value.length),
  onProblemsChange: (problems) => console.log(problems.length),
});

await editor.ready;
editor.getValue();
editor.setValue(text); // a no-op when the text is unchanged; otherwise applied as a minimal diff
editor.setMode('code');
editor.destroy();
```

`ready` resolves once the format is resolved, the code editor is mounted and the first validation has finished.
It rejects if the code editor or built-in formats fail to load (the failure is also shown in the editor). It does
not resolve if a schema load never settles, and it resolves (without a mount) when the editor is destroyed first. The
built-in formats are loaded only when the format option needs them: `'auto'` or a built-in id; an editor whose
`format` is the id of one of its `formats` never loads them. You do not have to await `ready`: a rejection you never
handle is not reported as unhandled.

The built-in formats and the CodeMirror adapter load on demand, so the main entry stays free of schemas and
CodeMirror. Give the host element a height: the editor fills it, with a 320px minimum.

### Options

| Option | Meaning |
| --- | --- |
| `format` | `'kubernetes'`, `'compose'`, the id of one of your `formats`, or `'auto'` to detect it from the text. Under `'auto'` the format is detected again whenever you set the text (`setValue`, `update({ value })`) and on undo and redo; typing never switches a detected format. Change it later with `setFormat`. |
| `value`, `mode` | The initial text, and `'visual'`, `'split'` (the default) or `'code'`. |
| `readOnly` | Blocks edits in both panes. Change it later with `setReadOnly`. |
| `theme` | `'light'`, `'dark'`, or `'auto'` (the default) to follow `prefers-color-scheme`. Change it later with `setTheme`. |
| `codeEditor` | A `CodeEditorAdapter`. The default is the CodeMirror adapter. |
| `formats` | Extra `FormatDefinition`s, for a format of your own. |
| `guide` | Guide overrides keyed by format id (`{ kubernetes: { fields: { ... } } }`), merged over the format's built-in guide: labels, descriptions, tiers and widgets. |
| `recipes` | Starter recipes added to the built-in ones. A recipe with a built-in's `id` replaces it. |
| `widgets` | A `WidgetRegistry` merged over the built-in widgets. |
| `variables` | Where compose variables are declared: `{ store: 'x-variables' }` (the default) or `{ store: 'external', value }`. See [Compose variables](#compose-variables). |
| `messages` | `{ ui?, schema?, locale? }`: translations, see [Messages](#messages). |
| `onChange(value, { origin })` | Called after every change. `origin` is `'visual'`, `'code'`, `'api'` (`setValue`) or `'history'` (undo and redo). |
| `onProblemsChange(problems)` | Called with the problems (a frozen array) when the validation result changes. |
| `onModeChange(mode)` | Called when the mode changes: by the user, by `setMode`, or when an "Edit in code" or "Jump to error" link opens Split from Visual. |
| `onVariablesChange(decls)` | Called when the effective variable declarations change. See [Compose variables](#compose-variables). |

`value`, `mode`, `readOnly`, `theme` and `format` are initial values with setters (`setValue`, `setMode`,
`setReadOnly`, `setTheme`, `setFormat`); `update({ format, value, variables, readOnly, mode, theme })` sets several
at once, in that order. The other options are read once, when the editor is created. These setters do nothing
(and call no callback) when the value is already current, `setFormat('auto')` on an `'auto'` editor included; a
`variables` list in `update` is applied (and re-validated) even when unchanged, as `setVariables` does. A callback
that throws is logged and does not stop the editor.

The controller (`ManifestEditorController`) also has `getFormat()`, `getActiveFormat()`, `getMode()`,
`getProblems()`, `getReadOnly()`, `undo()`, `redo()` and `reveal(ref)`, which selects a node (`{ doc, path }`) in both
panes, and `getVariables()`, `setVariables(decls)` and `applyFix(problem)` for variables and quick fixes (below).
`getFormat()` returns the format option (`'auto'` or an id), so it round-trips with `setFormat` as `getMode()` does
with `setMode`: bind both to keep `'auto'` detecting. `getActiveFormat()` returns the id of the format it resolved to,
or `undefined`. A host format whose `detect` throws is logged and resolves to no format.

Not every action can run: `applyFix` returns an `ActionResult`, `{ ok: true }` or `{ ok: false, reason }`.
`reason` is an `ActionRefusal`: `'no-fix'`, `'read-only'`, `'destroyed'`, `'unavailable'` (no variables for this
format, or the text does not parse), `'invalid'`, `'name-taken'`, `'not-found'`, `'already-declared'` or
`'edit-refused'`; exactly an `'edit-refused'` result also has `edit`, the edit engine's own `EditRefusal`. A refused
action changes nothing. More reasons may be added later: treat an unknown one like `'unavailable'`.

### Compose variables

Compose files interpolate `${VAR}` in any value. For the compose format the editor lets you declare variables,
use them from a field's "Use variable" toggle (it lists only variables whose type fits the field) and validates
the result. A declaration is `{ name, type, enumValues?, default?, description? }`, where `type` is one of `VARIABLE_TYPES`
(`'string'`, `'number'`, `'boolean'`, `'port'`, `'enum'`). `VariableDecl` is a union on `type`: `default` is typed per
member (a string, number, boolean, port number or one of the enum values) and `enumValues` exists only on, and is
required for, the `enum` member. `validateVariableDecl(value)` returns a `VariableDeclIssue` (`'badName'`, ...) or
`undefined`, so a host can check a declaration before passing it on. Kubernetes has no variables: the toggle, the Variables section and
the variable rules are absent there.

- The editor writes a bare `${VAR}` and never an inline default, and never resolves values into the text. A
  hand-written `${VAR:-x}` is kept as it is.
- Before schema checks each placeholder is replaced by its declared default (or its inline default). A placeholder
  with no default is checked by its declared type only: the schema errors at that exact path are dropped, and the
  rule `variable-type` reports a declared type that does not fit the field.
- Compose union types such as `["boolean","string"]` exist for interpolation. The widget for such a field is the
  boolean or enum control, and a string that is not a placeholder falls back to read-only text there ("Edit in
  code"). Text-input widgets (number, integer, quantity) keep showing the string with its error.

Where the declarations live is the `variables` option, chosen when the editor is created:

```ts
// The default: a top-level `x-variables:` block in the compose file (compose ignores `x-` keys).
createManifestEditor(el, { format: 'compose', variables: { store: 'x-variables' } });

// External: the host owns the list.
const editor = createManifestEditor(el, {
  format: 'compose',
  variables: { store: 'external', value: [{ name: 'WEB_PORT', type: 'port', default: 8080 }] },
  onVariablesChange: (decls) => save(decls),
});
editor.getVariables(); // the effective declarations
editor.setVariables([{ name: 'TAG', type: 'string', default: '1.27' }]); // external only
```

The `x-variables` block maps each name to an entry; `enum` holds a list of strings and maps to `enumValues`:

```yaml
x-variables:
  WEB_PORT: { type: port, default: 8080, description: Public port }
  STAGE: { type: enum, enum: [dev, prod], default: dev }
```

`onVariablesChange` fires whenever the effective declarations change: an edit in the Variables section, a quick
fix, or a text edit of the block. It does not fire for `setVariables`. With the `x-variables` store `setVariables`
is a no-op that logs a `console.warn`, because the declarations live in the document. Invalid declarations (a bad
or duplicate name, an unknown type, an `enum` without values, a default of the wrong type) passed to the
`variables.value` option or to `setVariables` throw a `TypeError`. Renaming a variable changes its declaration
only: references to the old name become undeclared and show a warning with a "Declare variable" fix.

`applyFix(problem)` applies a problem's quick fix (`problem.fix`) as one undo step, all of it or nothing, and
returns an `ActionResult`. The fix applies to the current text (its edits address nodes by path), not to the text the
problem was found in. A fix that declares a variable never replaces one that is already declared: it is refused with
`'already-declared'`. The panel, the visual rows and the code pane already offer a Fix button for every problem that has one (the
code pane only while the editor is editable), and say so when a fix is refused; `applyFix` is for hosts that build
their own problem list. The Variables section also appears first in the outline. On an empty compose document (or
one with only comments), "Add variable" starts the document with the `x-variables` block. The declarations that
`getVariables()` returns and `onVariablesChange` receives are frozen, and `getVariables()` returns the same array until
the declarations change, so it can be compared by identity.

### Semantic rules

After schema validation `validateText` runs the format's `rules` (`FormatDefinition.rules`). Their problems have
`source: 'rule'` and the code `rule.<id>`. `Problem.code` is a `ProblemCode`: `yaml.syntax|warning|data`,
`schema.<keyword>`, `kind.unknown|apiVersion`, `format.extraDocument` or `rule.<id>`. A quick fix has a stable `id`
(the rule's fix key, such as `fix.add-resources`), and `sameProblem(a, b)` tells whether two problems are the same
(severity, code, message, document, range and fix id and action). A rule that throws becomes one `rule.failed` error (and a
`console.error` with the thrown error) and the other rules still run. `validateText(parsed, format, { variables })`
replaces the document's own declarations with `variables`; rules then see `variableSource: 'host'` (otherwise
`'document'`).

| Code | Severity | Format | Reports |
| --- | --- | --- | --- |
| `rule.service-selector` | warning | Kubernetes | A Service `selector` that matches no workload's pod labels. |
| `rule.selector-mismatch` | error | Kubernetes | A workload's `selector.matchLabels` that its pod template labels do not satisfy. |
| `rule.missing-resources` | warning | Kubernetes | A container with no `resources`. Quick fix: add them. |
| `rule.target-port` | warning | Kubernetes | A Service `targetPort` name that no container port has. |
| `rule.undeclared-variable` | warning | compose | A `${VAR}` that is not declared. Quick fix: declare it. |
| `rule.variable-default` | warning | compose | An inline default that differs from the declared default. |
| `rule.variable-declaration` | error | compose | A malformed declaration in the `x-variables` block. |
| `rule.variable-type` | error | compose | A variable whose declared type does not fit the field it is used in. |

Selector rules read `matchLabels` only. "Workloads" are Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob
and Pod.

A rule is `{ id, messages, check(input) }`. `check` receives the parsed text, the data and schema bundle of each
document (one entry per document, `undefined` where there is none), the variable declarations in effect, and
`message(key, params?)`, which formats an entry of the merged message table (a key missing from it gives the key
itself and one `console.warn`), and `locate`. It returns `RuleFinding`s (severity,
document, path, optional `params` and an optional `fix`). A `fix` is a `RuleFix`: a label key (with its `params`)
plus an action that either declares a variable or applies edit operations; the problem gets it as a `QuickFix` with
the label resolved. Add rules to your own format through `FormatDefinition.rules`.

Rule messages resolve through the same table as schema messages, so override them by key with `messages.schema`
(an entry per code such as `'rule.missing-resources'`, plus the rule's fix label keys such as
`'fix.add-resources'`) in `createManifestEditor` or in the `messages` option of `validateText`. An override that
throws falls back to the default message, with one `console.warn` per key:

```ts
createManifestEditor(el, {
  messages: { schema: { 'rule.missing-resources': (e) => `Set CPU and memory for "${String(e.params['name'])}".` } },
});
```

### Starter recipes

When the document is empty the editor offers "Start from a template" cards: Web app, Background worker, Scheduled
job and Config and secret for Kubernetes, and Web app, App with Postgres and App with Redis for compose.
Choosing one inserts valid YAML and selects the value that most needs replacing (the recipe's `focus`); in Visual
and Split modes that field's input also gets keyboard focus. Add your own:

```ts
createManifestEditor(el, {
  recipes: [{ id: 'my-job', format: 'kubernetes', title: 'My job', description: 'A job with our defaults.', yaml: '...' }],
});
```

### The code editor

The code pane is a `CodeEditorAdapter`. The CodeMirror 6 adapter lives at `@stack-weaver/core/editors/codemirror`.
Its packages are peer dependencies, so install them next to the core:

```sh
pnpm add @codemirror/autocomplete @codemirror/commands @codemirror/lang-yaml @codemirror/language \
  @codemirror/lint @codemirror/state @codemirror/view @lezer/highlight
```

```ts
import { codemirrorAdapter } from '@stack-weaver/core/editors/codemirror';

createManifestEditor(el, { codeEditor: codemirrorAdapter({ extensions: [/* your CodeMirror extensions */] }) });
```

Passing it yourself is optional: without `codeEditor` the editor imports the same adapter on first use.

To use another editor (Monaco, say), implement `CodeEditorAdapter`: `mount(el, init)` returns an instance (or a
promise of one, for an editor that loads late) with
`getText`, `applyChange`, `setDiagnostics`, `reveal`, `getSelection`, `setReadOnly`, `setTheme`, `focus` and
`destroy`. The `init` object gives your editor the initial text, `onChange`, the completion and hover callbacks
(`hover` may answer with a promise; a rejection shows no tooltip), and `onUndo` and `onRedo`. If the editor is
destroyed before an async `mount` resolves, the instance is destroyed as soon as it arrives (a mount that fails after
`destroy()` is only logged). `codemirrorAdapter()` returns a `SyncCodeEditorAdapter`, whose `mount` returns the
instance itself, never a promise; the type is exported from the root and from the subpath. Each `CodeDiagnostic`
you receive in `setDiagnostics` has the problem's `code` and `source`, and each of its `actions` an `id` (the quick
fix id), next to `label` and `apply()`. Route the undo keys to those two callbacks and do not install an undo history of your
own, so there is one history for both panes. Keep the text byte for byte (never normalize line endings), and use
offsets into that text everywhere, where `\r\n` counts as two characters; the CodeMirror adapter translates
CodeMirror's positions, which count a line break as one. If `mount` throws, the code pane shows an error message
instead and `ready` rejects.

### Theming

All classes are `sw-*` and all custom properties `--sw-*`; both are public. Override tokens on `.sw-editor`:

```css
.sw-editor {
  --sw-accent: #8250df;
  --sw-radius: 2px;
}
```

| Token | Use |
| --- | --- |
| `--sw-bg`, `--sw-fg`, `--sw-muted` | Surface, text and secondary text. |
| `--sw-border` | Decorative dividers, splitters and the editor frame. |
| `--sw-control-border` | The border of an input, select, textarea or button. Keep it at least 3:1 against `--sw-bg`. |
| `--sw-accent`, `--sw-on-accent` | The selected item and the checked mode button, and the text on them. |
| `--sw-error`, `--sw-warning`, `--sw-info` | Problem colours; `--sw-accent`, `--sw-info`, `--sw-warning` and `--sw-muted` also colour the YAML syntax. |
| `--sw-focus` | The focus ring. Keep it at least 3:1 against `--sw-bg`. |
| `--sw-radius`, `--sw-gap`, `--sw-font`, `--sw-mono` | Shape, spacing and fonts. |
| `--sw-selection`, `--sw-active-line` | Optional: the code pane's selection and active-line colours. |

The dark theme is the `data-sw-theme="dark"` attribute, which the editor sets from the `theme` option.

### Messages

Every string the editor shows is in `messages`. Pass only the ones you change:

```ts
createManifestEditor(el, {
  messages: {
    ui: { undo: 'Rückgängig', redo: 'Wiederholen' }, // every key is in `defaultUiMessages`
    schema: {}, // validation messages: every key is in `defaultMessages`
    locale: 'de', // plural rules for count messages; default 'en'; read once, when the editor is created
  },
});
```

`locale` must be a tag `Intl` accepts; an invalid one counts as `'en'` and logs one `console.warn`. Widgets get it as
`WidgetContext.locale`.

Many texts are templates with `{…}` placeholders, such as `removeField` (`'Remove {label}'`), `removeVariable`
(`'Remove variable {name}'`), `itemLabel` (`'Item {n}'`), `problemPrefix` (`'{severity}: '`) and `formatBadge`
(`'{label} {version}'`, the format badge); `defaultUiMessages` shows every key with its placeholders. They are filled
in one pass: a value is inserted as written, never expanded again, and an unknown `{x}` stays as is. A message that
depends on a count is a plural table, `problemCount`, with `none` (used for exactly 0 when present), the plural
categories `zero`, `one`, `two`, `few` and `many`, and a required `other`; `locale` picks the category with
`Intl.PluralRules`. `zero` is that category, not "none": English never selects it, and Latvian selects it for 10.
`{count}` is the number:

```ts
messages: {
  locale: 'ru',
  ui: { problemCount: { none: 'Нет проблем', one: '{count} проблема', few: '{count} проблемы', many: '{count} проблем', other: '{count} проблемы' } },
}
```

`formatMessage(template, params)` and `formatPlural(message, count, locale, params)` are exported for your own strings.
`UiMessages` is readonly; `problemPrefix` (`'{severity}: '`) is spoken before a field's problem, with `severityError`,
`severityWarning` or `severityInfo` as `{severity}`. The keys `problemsNone`, `problemsOne` and `problemsMany` are
now `problemCount`, and `item` and `document` are `itemLabel` and `documentLabel`. New keys in this release:
`problemCount`, `itemLabel`, `documentLabel`, `problemPrefix`, `variableDefaultDropped` and `formatBadge`; a table
written for `problemCount` with `zero` for "No problems" must use `none`.

### Widgets

A field is edited by a widget. The guide names one (`widget: { name: 'ref', param: 'Secret' }`, a `WidgetRef`); otherwise one is picked from the
schema's shape. The built-in names are `string`, `number`, `integer`, `boolean`, `enum`, `int-or-string`,
`quantity`, `string-list`, `key-value`, `suggest`, `ref`, `ref-key` and `secret-data`. Add or replace one with the
`widgets` option:

```ts
import type { WidgetFactory } from '@stack-weaver/core';

const approvedImage: WidgetFactory = (ctx) => {
  const select = document.createElement('select');
  select.id = ctx.id; // the row's label points at this id
  for (const image of ['nginx:1.27', 'redis:7.4']) select.add(new Option(image, image));
  select.addEventListener('change', () => ctx.commit(select.value));
  return {
    el: select,
    update: (value, readOnly) => {
      select.value = String(value ?? '');
      select.disabled = readOnly;
    },
    focus: () => select.focus(),
  };
};

createManifestEditor(el, {
  widgets: { 'approved-image': { create: approvedImage } },
  guide: { kubernetes: { fields: { 'io.k8s.api.core.v1.Container#image': { widget: { name: 'approved-image' } } } } },
});
```

Guide keys come in two shapes. `guide.fields` is keyed by `<schema definition>#<property>`: the definition that
holds the property, so a container's image is `io.k8s.api.core.v1.Container#image` and a Deployment's replica count
is `io.k8s.api.apps.v1.DeploymentSpec#replicas`. `guide.kinds` is keyed by kind key, `<apiVersion>/<kind>` as
`kindKey(apiVersion, kind)` builds it, such as `apps/v1/Deployment`.

A widget that edits a whole mapping and adds and removes its keys itself sets `managesKeys: true` on its
definition (`{ create, managesKeys: true }`), as the Secret `data` widget does. The mapping is then not an outline
node or a section of its own: the widget is a row in its parent's section, and no "Add key" is offered for it.

A widget factory receives a `WidgetContext`: the field's `id`, `label`, `ref`, `value`, `schema`, `param` (from the
guide's `WidgetRef`), `messages`, `locale`, `commit(value)`, `edit(op, { group? })` and `guide()`, the format's guide
with your override merged in. A `WidgetRegistry` entry is a `WidgetDefinition`, not a bare function: a bare function
passed from plain JavaScript fails like a throwing widget (below). A custom widget context built by hand must supply
`guide()` and `locale`.

If a widget throws, its field falls back to read-only text with a note and an "Edit in code" link, and the error is
logged with `console.error`.

### Formats as data

Field-name knowledge lives in the guide, so a format of your own gets the same behaviour as the built-ins without
code. `Guide.labelKeys` lists the keys whose string value names a sequence item in the outline and field rows
(`['name']` for Kubernetes containers; the first match wins). `Guide.resourceLabel` is the path whose value labels a
document next to its kind (`['metadata', 'name']` gives `Deployment web`). `Guide.references` is keyed by the kind a
`ref` or `ref-key` widget names in its `param`, with `{ nameKey, dataKeys }`: the key next to the field that holds
the referenced name, and the top-level keys of the referenced document whose map keys are suggested. All three
can be overridden with the `guide` option; without them a format gets no such labels or suggestions. In the headless
functions, `hoverAt(parsed, offset, bundle, guide)` takes the guide (its field hints) and `breadcrumbAt(parsed,
offset, documentLabel?, guide?)` takes it as an optional fourth argument: pass the format's `guide` to label a
document by its name, otherwise it is named by its kind alone. `kindCatalog(format, guide?)` builds the "Add
resource" catalog from a guide (default: the format's own); the editor's picker passes the guide with your override.

## Development

Run the playground with `pnpm --filter @stack-weaver/core dev`. It serves `examples/playground.html`, which
imports from `src` directly, so it needs no build (a `predev` step runs the generators for the version file and
schemas, like `pretest`).

The first `test`, `build` or `typecheck` downloads the pinned upstream schemas (cached in
`.cache/` afterwards), so it needs network access to `raw.githubusercontent.com`. Re-pinning with
`--update-lock` also lists files through the GitHub API: with the `gh` CLI when it is installed,
otherwise with `fetch`, authenticated by `GITHUB_TOKEN` when set.

### Updating the pinned schemas

The Kubernetes and compose schemas are generated from upstream sources pinned by URL and sha256 in
`schema-sources.lock.json`. A normal `test`, `build` or `typecheck` only reads the lockfile and
fails if a pin is missing or does not match. To move to another version:

1. Change `TAG` in `scripts/gen-kubernetes.mjs` or `COMMIT` in `scripts/gen-compose.mjs` (and the
   matching `version` in `src/formats/kubernetes/index.ts` or `src/formats/compose/index.ts`).
2. Run `node scripts/gen-kubernetes.mjs --update-lock` or `node scripts/gen-compose.mjs --update-lock`
   to download the new sources and re-pin them.
3. Review and commit the `schema-sources.lock.json` diff together with the version change.

## License

MIT
