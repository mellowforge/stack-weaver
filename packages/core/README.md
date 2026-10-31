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
not resolve if a schema load never settles. You do not have to await it: a rejection you never handle is not
reported as unhandled.

The built-in formats and the CodeMirror adapter load on demand, so the main entry stays free of schemas and
CodeMirror. Give the host element a height: the editor fills it, with a 320px minimum.

### Options

| Option | Meaning |
| --- | --- |
| `format` | `'kubernetes'`, `'compose'`, or `'auto'` to detect it from the text. |
| `value`, `mode` | The initial text, and `'visual'`, `'split'` (the default) or `'code'`. |
| `readOnly` | Blocks edits in both panes. Change it later with `setReadOnly`. |
| `theme` | `'light'`, `'dark'`, or `'auto'` (the default) to follow `prefers-color-scheme`. Change it later with `setTheme`. |
| `codeEditor` | A `CodeEditorAdapter`. The default is the CodeMirror adapter. |
| `formats` | Extra `FormatDefinition`s, for a format of your own. |
| `guide` | Guide overrides keyed by format id (`{ kubernetes: { fields: { ... } } }`), merged over the format's built-in guide: labels, descriptions, tiers and widgets. |
| `recipes` | Starter recipes added to the built-in ones. A recipe with a built-in's `id` replaces it. |
| `widgets` | A `WidgetRegistry` merged over the built-in widgets. |
| `variables` | Where compose variables are declared: `{ store: 'x-variables' }` (the default) or `{ store: 'external', value }`. See [Compose variables](#compose-variables). |
| `messages` | `{ ui?, schema? }`: translations, see below. |
| `onChange(value, { origin })` | Called after every change. `origin` is `'visual'`, `'code'`, `'api'` (`setValue`) or `'history'` (undo and redo). |
| `onProblemsChange(problems)` | Called when the validation result changes. |
| `onModeChange(mode)` | Called when the mode changes: by the user, by `setMode`, or when an "Edit in code" or "Jump to error" link opens Split from Visual. |
| `onVariablesChange(decls)` | Called when the effective variable declarations change. See [Compose variables](#compose-variables). |

`value`, `mode`, `readOnly` and `theme` are initial values with setters (`setValue`, `setMode`, `setReadOnly`,
`setTheme`). The other options are read once, when the editor is created. `setValue` and `setMode` do nothing (and
call no callback) when the value is already current. A callback that throws is logged and does not stop the editor.

The controller also has `getMode()`, `getProblems()`, `getReadOnly()`, `undo()`, `redo()` and `reveal(ref)`, which
selects a node (`{ doc, path }`) in both panes, and `getVariables()`, `setVariables(decls)` and `applyFix(problem)`
for variables and quick fixes (below).

### Compose variables

Compose files interpolate `${VAR}` in any value. For the compose format the editor lets you declare variables,
use them from a field's "Use variable" toggle (it lists only variables whose type fits the field) and validates
the result. A declaration is `{ name, type, enumValues?, default?, description? }`, where `type` is `'string'`,
`'number'`, `'boolean'`, `'port'` or `'enum'`. Kubernetes has no variables: the toggle, the Variables section and
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

`applyFix(problem)` applies a problem's quick fix (`problem.fix`) as one undo step and returns whether it was
applied. The panel, the visual rows and the code pane already offer a Fix button for every problem that has one;
`applyFix` is for hosts that build their own problem list. The Variables section also appears first in the outline.

### Semantic rules

After schema validation `validateText` runs the format's `rules` (`FormatDefinition.rules`). Their problems have
`source: 'rule'` and the code `rule.<id>`. A rule that throws becomes one `rule.failed` error and the other rules
still run.

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
document, the variable declarations in effect, and `message(key, params?)`, which formats an entry of the merged
message table. It returns `RuleFinding`s (severity, document, path, optional `params` and an optional `fix`). A
`fix` is a `QuickFix`: a label key plus an action that either declares a variable or applies edit operations. Add
rules to your own format through `FormatDefinition.rules`.

Rule messages resolve through the same table as schema messages, so override them by key with `messages.schema`
(an entry per code such as `'rule.missing-resources'`, plus the rule's fix label keys such as `'fix.add-resources'`) in `createManifestEditor` or in the `messages` option of
`validateText`:

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

To use another editor (Monaco, say), implement `CodeEditorAdapter`: `mount(el, init)` returns an instance with
`getText`, `applyChange`, `setDiagnostics`, `reveal`, `getSelection`, `setReadOnly`, `setTheme`, `focus` and
`destroy`. The `init` object gives your editor the initial text, `onChange`, the completion and hover callbacks,
and `onUndo` and `onRedo`. Route the undo keys to those two callbacks and do not install an undo history of your
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
  },
});
```

### Widgets

A field is edited by a widget. The guide names one (`widget: 'ref:Secret'`); otherwise one is picked from the
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
  widgets: { 'approved-image': approvedImage },
  guide: { kubernetes: { fields: { 'io.k8s.api.core.v1.Container#image': { widget: 'approved-image' } } } },
});
```

Guide keys come in two shapes. `guide.fields` is keyed by `<schema definition>#<property>`: the definition that
holds the property, so a container's image is `io.k8s.api.core.v1.Container#image` and a Deployment's replica count
is `io.k8s.api.apps.v1.DeploymentSpec#replicas`. `guide.kinds` is keyed by kind key, `<apiVersion>/<kind>` as
`kindKey(apiVersion, kind)` builds it, such as `apps/v1/Deployment`.

A widget that edits a whole mapping and adds and removes its keys itself sets `managesKeys: true` on the factory,
as the Secret `data` widget does. The mapping is then not an outline node or a section of its own: the widget is a
row in its parent's section, and no "Add key" is offered for it.

If a widget throws, its field falls back to read-only text with a note and an "Edit in code" link, and the error is
logged with `console.error`.

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
