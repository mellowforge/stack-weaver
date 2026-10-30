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

await editor.ready; // the code editor and the first schema are loaded
editor.getValue();
editor.setValue(text); // a no-op when the text is unchanged; otherwise applied as a minimal diff
editor.setMode('code');
editor.destroy();
```

The built-in formats and the CodeMirror adapter load on demand, so the main entry stays free of schemas and
CodeMirror. Give the host element a height: the editor fills it, with a 320px minimum.

### Options

| Option | Meaning |
| --- | --- |
| `format` | `'kubernetes'`, `'compose'`, or `'auto'` to detect it from the text. |
| `value`, `mode` | The initial text, and `'visual'`, `'split'` (the default) or `'code'`. |
| `readOnly` | Blocks edits in both panes. Change it later with `setReadOnly`. |
| `theme` | `'light'`, `'dark'`, or `'auto'` to follow `prefers-color-scheme`. |
| `codeEditor` | A `CodeEditorAdapter`. The default is the CodeMirror adapter. |
| `formats` | Extra `FormatDefinition`s, for a format of your own. |
| `guide` | Guide overrides keyed by format id (`{ kubernetes: { fields: { ... } } }`), merged over the format's built-in guide: labels, descriptions, tiers and widgets. |
| `recipes` | Starter recipes added to the built-in ones. A recipe with a built-in's `id` replaces it. |
| `widgets` | A `WidgetRegistry` merged over the built-in widgets. |
| `messages` | `{ ui?, schema? }`: translations, see below. |
| `onChange(value, { origin })` | Called after every change. `origin` is `'visual'`, `'code'`, `'api'` (`setValue`) or `'history'` (undo and redo). |
| `onProblemsChange(problems)` | Called when the validation result changes. |
| `onModeChange(mode)` | Called when the user, or `setMode`, switches mode. |

The controller also has `getMode()`, `getProblems()`, `undo()`, `redo()` and `reveal(ref)`, which selects a node
(`{ doc, path }`) in both panes.

### Starter recipes

When the document is empty the editor offers "Start from a template" cards: Web app, Background worker, Scheduled
job and Config and secret for Kubernetes, and Web app, App with Postgres and App with Redis for compose.
Choosing one inserts valid YAML and puts focus on the first value that needs replacing. Add your own:

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
own, so there is one history for both panes.

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

const colour: WidgetFactory = (ctx) => {
  const input = document.createElement('input');
  input.id = ctx.id; // the row's label points at this id
  input.type = 'color';
  input.addEventListener('change', () => ctx.commit(input.value));
  return {
    el: input,
    update: (value, readOnly) => {
      input.value = String(value ?? '#000000');
      input.disabled = readOnly;
    },
    focus: () => input.focus(),
  };
};

createManifestEditor(el, {
  widgets: { colour },
  guide: { kubernetes: { fields: { 'io.k8s.api.core.v1.Pod#color': { widget: 'colour' } } } },
});
```

A widget for a mapping that adds and removes its own keys sets `managesKeys: true` on the factory, as the Secret
`data` widget does, so its section shows no "Add key".

## Development

Run the playground with `pnpm --filter @stack-weaver/core dev`. It serves `examples/playground.html`, which
imports from `src` directly and needs no build.

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
