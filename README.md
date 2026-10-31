# stack-weaver

A schema-driven visual and code editor for Kubernetes and docker-compose YAML, for vanilla JS, React and Angular.

## Why stack-weaver?

- **Two views, one document.** Visual, Split and Code modes edit the same text. An edit in either pane shows up in the other, and undo and redo span both.
- **Your YAML stays yours.** Paste any valid manifest and change nothing, and you get the same bytes back. A visual edit changes only the lines of the node it edits: comments, key order and unknown fields survive.
- **Schema-driven.** Fields, hints and validation come from schemas plus a guide overlay, so a new field or kind is a data change. Semantic rules and one-click quick fixes run on top of the schema checks.
- **Compose variables.** `${VAR}` placeholders are declared in an `x-variables:` block or in a list your app owns, and fields can use them.
- **Extensible.** Add formats, widgets, starter recipes, messages (and translations) and your own code editor through the public options.
- **Accessible and themeable.** WAI-ARIA patterns, light and dark themes, and `--sw-*` CSS custom properties.

## Packages

| Package | Description |
| --- | --- |
| [`@stack-weaver/core`](packages/core) | The framework-agnostic editor: document model, Kubernetes and compose formats, visual and code panes |
| [`@stack-weaver/react`](packages/react) | `<ManifestEditor>` for React 19 |
| [`@stack-weaver/angular`](packages/angular/projects/stack-weaver-angular) | `<sw-manifest-editor>` for Angular 22 |

## Installation

The wrappers have `@stack-weaver/core` as a peer dependency. Install the one you need:

```sh
pnpm add @stack-weaver/core                                    # vanilla JS / TS
pnpm add @stack-weaver/react @stack-weaver/core react react-dom   # React
pnpm add @stack-weaver/angular @stack-weaver/core              # Angular
```

The default code pane is CodeMirror 6, loaded on first use. Its packages are peer dependencies of the core, so install them too (or pass your own `CodeEditorAdapter` and skip them):

```sh
pnpm add @codemirror/autocomplete @codemirror/commands @codemirror/lang-yaml @codemirror/language \
  @codemirror/lint @codemirror/state @codemirror/view @lezer/highlight
```

All packages are ESM-only. Import the stylesheet once: `@stack-weaver/core/stack-weaver.css`. The wrappers ship no CSS of their own.

## Quick start

### React

```tsx
import { ManifestEditor } from '@stack-weaver/react';
import '@stack-weaver/core/stack-weaver.css';

export function Editor({ text, setText }: { text: string; setText: (text: string) => void }) {
  return <ManifestEditor style={{ height: 480 }} value={text} onChange={setText} format="auto" />;
}
```

### Angular

```ts
import { Component, signal } from '@angular/core';
import { SwManifestEditor } from '@stack-weaver/angular';

@Component({
  selector: 'app-editor',
  imports: [SwManifestEditor],
  template: `<sw-manifest-editor style="height: 480px" [(value)]="text" format="auto" />`,
})
export class Editor {
  readonly text = signal('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n');
}
```

Add `@import '@stack-weaver/core/stack-weaver.css';` to your global `styles.css`.

### Vanilla JS / TS

```ts
import { createManifestEditor } from '@stack-weaver/core';
import '@stack-weaver/core/stack-weaver.css';

const editor = createManifestEditor(document.getElementById('editor')!, {
  format: 'auto',
  value: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n',
  mode: 'split',
  onChange: (value, { origin }) => console.log(origin, value.length),
});

await editor.ready;
editor.destroy();
```

## Documentation

- [`@stack-weaver/core`](packages/core/README.md): options, controller, formats, variables, rules, theming and messages
- [`@stack-weaver/react`](packages/react/README.md): props, rules and the ref
- [`@stack-weaver/angular`](packages/angular/projects/stack-weaver-angular/README.md): inputs, outputs and rules
- [Demo site](https://constantine-24.github.io/stack-weaver/): the same editor in Vanilla JS, React and Angular
- [Design spec](docs/superpowers/specs/2026-10-30-stack-weaver-design.md)

## Compatibility

| Package | Runtime |
| --- | --- |
| `@stack-weaver/core` | Any evergreen browser (ES2022) |
| `@stack-weaver/react` | React 19. Safe under `<StrictMode>` and server rendering. |
| `@stack-weaver/angular` | Angular 22, standalone. Works with zone.js and zoneless. |

## Limitations

- No connection to a cluster: no apply or dry-run, no live state, no fetching schemas from a cluster.
- No multi-file projects. The editor takes one YAML document string in and gives one out (a `.env` file plus compose is out, and so is a folder of manifests).
- No CRD or custom resource schemas. Unknown kinds are kept as-is and can only be edited in code.
- No Helm or Kustomize, whether templates, `values.yaml` or `kustomization.yaml`.
- No Dockerfile editing: it is not YAML and has no schema.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
