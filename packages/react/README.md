# @stack-weaver/react

React bindings for [`@stack-weaver/core`](https://www.npmjs.com/package/@stack-weaver/core), a schema-driven visual and
code editor for Kubernetes and docker-compose YAML. `<ManifestEditor>` wraps the core's `createManifestEditor`: the
same editor, with props in place of options and setters.

Requires React 19. Safe under `<StrictMode>` and for server rendering: the editor is built in an effect, so the
server renders an empty `div`.

## Install

`react`, `react-dom` and `@stack-weaver/core` are peer dependencies, so install them together:

```sh
pnpm add @stack-weaver/react @stack-weaver/core react react-dom
# or: npm install @stack-weaver/react @stack-weaver/core react react-dom
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

Import the editor stylesheet once, in your entry file:

```ts
import '@stack-weaver/core/stack-weaver.css';
```

This package ships no CSS of its own. Give the host `div` a height (`className` or `style`): the editor fills it.

## Usage

```tsx
import { useRef, useState } from 'react';
import { ManifestEditor, type ManifestEditorController } from '@stack-weaver/react';
import '@stack-weaver/core/stack-weaver.css';

const START = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: app\n';

export function Editor() {
  const editor = useRef<ManifestEditorController>(null);
  const [text, setText] = useState(START);
  const [format, setFormat] = useState<string | undefined>();
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  return (
    <>
      <p>Format: {format ?? 'none'}</p>
      <button type="button" disabled={!history.canUndo} onClick={() => editor.current?.undo()}>
        Undo
      </button>
      <ManifestEditor
        ref={editor}
        style={{ height: 480 }}
        value={text}
        onChange={setText}
        format="auto"
        onFormatChange={setFormat}
        onHistoryChange={setHistory}
      />
    </>
  );
}
```

### Rules

- **Pass stable objects.** `codeEditor`, `formats`, `recipes`, `guide`, `widgets` and `messages` are read when the
  editor is created. A new reference recreates the editor, and so does a new `variables` store kind (`store`, not the
  object). Keep these in module constants, `useMemo` or state. Callbacks are different: an inline `onChange` is fine,
  and the newest one is always called.
- **`value` is pushed only when it changes.** A `value` prop is pushed to the editor when it differs from the previous
  render's `value` and from the editor's text. A parent that does not update `value` from `onChange` keeps the user's
  text: an unrelated re-render never pushes the old `value` back. A pushed `value` does not call `onChange`; text set
  through the ref (`ref.current.setValue`) does, with origin `'api'`. `defaultValue` is read once. `mode` follows the
  same rule: a pushed `mode` does not call `onModeChange`, while `ref.current.setMode` does. `format`, `readOnly`,
  `theme` and an `external` `variables.value` are pushed when they change.
- **Recreation loses the undo history.** A recreated editor keeps the text, mode, format option, read-only state and
  theme, but starts with nothing to undo.
- **`ref` is the controller.** It receives the live `ManifestEditorController` (`getValue`, `undo`, `redo`, `reset`,
  `applyFix`, `ready`, ...) and `null` after unmount. A recreated editor is a new controller, so do not keep
  `ref.current` across renders.
- **`format` vs `onFormatChange`.** `format` is the option (`'auto'` or a format id), and the editor never changes it.
  `onFormatChange` reports the format it resolved to. Under `'auto'` that changes as the text does, so do not feed
  it back into `format`: that would pin the format and stop detection.

## API

### `<ManifestEditor>` props

Other props (`className`, `style`, `id`, `aria-*`, `data-*`, ...) go to the host `div`. It has no children: the
editor owns its content.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | none | The text, controlled. Pushed only when it changes (see Rules). |
| `defaultValue` | `string` | `''` | The initial text when `value` is not given. Read once. |
| `onChange` | `(value: string, meta: { origin: ChangeOrigin }) => void` | none | Every text change: `'code'`, `'visual'`, `'history'` or `'api'`. Not called for a pushed `value`. |
| `mode` | `'visual' \| 'split' \| 'code'` | `'split'` | Which panes are shown. Pushed only when it changes. |
| `onModeChange` | `(mode: EditorMode) => void` | none | The mode switch, `ref.current.setMode`, or a control that opens Split. Not called for a pushed `mode`. |
| `format` | `'auto' \| 'kubernetes' \| 'compose' \| string` | `'auto'` | The format option. `'auto'` detects the format from the text. |
| `onFormatChange` | `(activeFormat: string \| undefined) => void` | none | The resolved format changed. Also called once when the editor first resolves its format. |
| `readOnly` | `boolean` | `false` | Blocks user edits. |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | Colour scheme. `'auto'` follows `prefers-color-scheme`. |
| `variables` | `VariablesOption` | `{ store: 'x-variables' }` | Where variable declarations live. The store kind is init-only. With `{ store: 'external', value }`, a new `value` array is pushed. |
| `onVariablesChange` | `(decls: readonly VariableDecl[]) => void` | none | An edit changed the declarations. |
| `onProblemsChange` | `(problems: readonly Problem[]) => void` | none | The problems changed. |
| `onHistoryChange` | `(state: { canUndo: boolean; canRedo: boolean }) => void` | none | `canUndo` or `canRedo` changed. Drive your own undo buttons with it. |
| `codeEditor` | `CodeEditorAdapter` | CodeMirror, loaded on demand | The code pane. Init-only. |
| `formats` | `readonly FormatDefinition[]` | none | Extra formats. Init-only. |
| `recipes` | `readonly Recipe[]` | none | Extra starter recipes. Init-only. |
| `guide` | `Record<string, GuideOverride>` | none | Guide overrides by format id. Init-only. |
| `widgets` | `WidgetRegistry` | none | Input widgets by name. Init-only. |
| `messages` | `EditorMessages` | none | UI and schema message overrides, and the locale. Init-only. |
| `ref` | `Ref<ManifestEditorController \| null>` | none | The live controller (see Rules). |

The package also re-exports these core types: `ManifestEditorController`, `EditorMode`, `EditorTheme`, `ChangeOrigin`,
`Problem`, `VariableDecl`, `VariablesOption`, `FormatDefinition` and `Recipe`. Options and controller methods are
described in the core README.

## Demo

The site is the demo for the core, React and Angular. From the repository root:
`pnpm build && pnpm --filter @stack-weaver/site dev`.

## License

MIT
