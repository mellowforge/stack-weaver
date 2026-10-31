# @stack-weaver/angular

Angular bindings for [`@stack-weaver/core`](https://www.npmjs.com/package/@stack-weaver/core), a schema-driven visual
and code editor for Kubernetes and docker-compose YAML. `<sw-manifest-editor>` wraps the core's
`createManifestEditor`: the same editor, with inputs and outputs in place of options and setters.

Requires Angular 22. Works with and without zone.js: the editor's DOM listeners run outside the Angular zone, and state
flows through signals.

## Install

`@stack-weaver/core` is a peer dependency, so install both:

```sh
pnpm add @stack-weaver/angular @stack-weaver/core
# or: npm install @stack-weaver/angular @stack-weaver/core
```

The default code pane is CodeMirror 6, loaded on first use. Its packages are peer dependencies of the core, so install
them too:

```sh
pnpm add @codemirror/autocomplete @codemirror/commands @codemirror/lang-yaml @codemirror/language \
  @codemirror/lint @codemirror/state @codemirror/view @lezer/highlight
```

To use another code editor instead, pass a `CodeEditorAdapter` as `codeEditor` (see the core README) and skip the
CodeMirror packages. The packages are ESM-only.

## Styles

Import the editor stylesheet once, in your global `styles.css`:

```css
@import '@stack-weaver/core/stack-weaver.css';
```

This package ships no CSS of its own. `<sw-manifest-editor>` is a block element: give it a height and the editor
fills it.

## Usage

```ts
import { Component, signal, viewChild } from '@angular/core';
import { SwManifestEditor } from '@stack-weaver/angular';

const START = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n';

@Component({
  selector: 'app-editor',
  imports: [SwManifestEditor],
  template: `
    <p>Format: {{ format() ?? 'none' }}</p>
    <button type="button" [disabled]="!history().canUndo" (click)="editor().controller()?.undo()">Undo</button>
    <sw-manifest-editor
      style="height: 480px"
      [(value)]="text"
      [(mode)]="mode"
      format="auto"
      (activeFormatChange)="format.set($event)"
      (historyChange)="history.set($event)"
    />
  `,
})
export class Editor {
  readonly editor = viewChild.required(SwManifestEditor);
  readonly text = signal(START);
  readonly mode = signal<'visual' | 'split' | 'code'>('split');
  readonly format = signal<string | undefined>(undefined);
  readonly history = signal({ canUndo: false, canRedo: false });
}
```

### Rules

- **Pass stable objects.** `codeEditor`, `formats`, `recipes`, `guide`, `widgets` and `messages` are read when the
  editor is created. A new reference recreates the editor, and so does a new `variables` store kind (`store`, not the
  object). Keep these in module constants or class fields. A template literal is reused only until a value inside it
  changes, so `[guide]="{ kubernetes: override() }"` recreates the editor whenever `override()` changes.
- **`value` is pushed only when it changes.** A new `value` is pushed to the editor when it differs from the last
  text the editor reported and from the editor's text. A parent that binds `[value]` one way keeps the user's text:
  nothing pushes the old `value` back until the parent sets a different one. A pushed `value` is not written back
  through `valueChange`; text set through the controller (`controller().setValue`) is. `mode` follows the same rule,
  and `format`, `readOnly`, `theme` and an `external` `variables.value` are pushed when they change.
- **Recreation loses the undo history.** A recreated editor keeps the text, mode, format option, read-only state and
  theme, but starts with nothing to undo. If there was something to undo or redo, `historyChange` emits
  `{ canUndo: false, canRedo: false }`.
- **`controller()` is the controller.** Read it through `viewChild`: it returns the live `ManifestEditorController`
  (`getValue`, `undo`, `redo`, `reset`, `applyFix`, `ready`, ...), and `undefined` until after the first render and
  after destroy. A recreated editor is a new controller, so call `controller()` each time rather than keeping the result.
- **`format` vs `activeFormatChange`.** `format` is the option (`'auto'` or a format id), and the editor never changes
  it, so there is no `[(format)]`. `activeFormatChange` reports the format it resolved to. Under `'auto'` that changes
  as the text does, so do not feed it back into `format`: that would pin the format and stop detection.

## API

### `SwManifestEditor` (`<sw-manifest-editor>`)

The host element is the editor's container. It has no content of its own: the editor owns its children.

| Input | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | `''` | The text, two-way: `[(value)]`, or `[value]` + `(valueChange)`. Pushed only when it changes (see Rules). |
| `mode` | `'visual' \| 'split' \| 'code'` | `'split'` | Which panes are shown, two-way: `[(mode)]`. Pushed only when it changes. |
| `format` | `'auto' \| 'kubernetes' \| 'compose' \| string` | `'auto'` | The format option. `'auto'` detects the format from the text. |
| `readOnly` | `boolean` | `false` | Blocks user edits. Also accepts a static attribute: `<sw-manifest-editor readOnly />`. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | Colour scheme. `'auto'` follows `prefers-color-scheme`. |
| `variables` | `VariablesOption` | `{ store: 'x-variables' }` | Where variable declarations live. The store kind is init-only. With `{ store: 'external', value }`, a new `value` array is pushed. |
| `codeEditor` | `CodeEditorAdapter` | CodeMirror, loaded on demand | The code pane. Init-only. |
| `formats` | `readonly FormatDefinition[]` | none | Extra formats. Init-only. |
| `recipes` | `readonly Recipe[]` | none | Extra starter recipes. Init-only. |
| `guide` | `Record<string, GuideOverride>` | none | Guide overrides by format id. Init-only. |
| `widgets` | `WidgetRegistry` | none | Input widgets by name. Init-only. |
| `messages` | `EditorMessages` | none | UI and schema message overrides, and the locale. Init-only. |

| Output | Payload | When |
| --- | --- | --- |
| `valueChange` | `string` | Every text change: typing, the form, undo and redo, and controller calls. Not for a pushed `value`. |
| `modeChange` | `EditorMode` | The mode switch, `controller().setMode`, or a control that opens Split. |
| `activeFormatChange` | `string \| undefined` | The resolved format changed. Also emitted once when the editor first resolves its format. |
| `problemsChange` | `readonly Problem[]` | The problems changed. |
| `variablesChange` | `readonly VariableDecl[]` | An edit changed the declarations. |
| `historyChange` | `{ canUndo: boolean; canRedo: boolean }` | `canUndo` or `canRedo` changed. Drive your own undo buttons with it. |

| Method | Returns | Description |
| --- | --- | --- |
| `controller()` | `ManifestEditorController \| undefined` | The live controller (see Rules). |

The package also re-exports these core types: `ManifestEditorController`, `EditorMode`, `EditorTheme`, `ChangeOrigin`,
`Problem`, `VariableDecl`, `VariablesOption`, `FormatDefinition` and `Recipe`. Options and controller methods are
described in the core README.

## Demo

The site is the demo for the core, React and Angular. From `packages/angular`, after `pnpm build` at the repository
root: `ng serve site-demo`.

## License

MIT
