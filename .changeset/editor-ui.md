---
"@stack-weaver/core": minor
---

Adds the editor UI. `createManifestEditor(el, options)` mounts a Visual, Split or Code editor over one shared document model, so an edit in either pane shows up in the other and undo and redo span both. The visual pane has an outline tree, schema-driven field widgets (including references between resources and a decoded Secret `data` editor), an "Add resource" picker, starter recipes for an empty document and a banner for broken YAML. The code pane uses a CodeMirror 6 adapter at `@stack-weaver/core/editors/codemirror` (CodeMirror packages and `@lezer/highlight` are peer dependencies; bring your own through the `CodeEditorAdapter` interface). The code editor keeps the text byte for byte, CRLF included. Style it with `@stack-weaver/core/stack-weaver.css` and its `--sw-*` tokens, switch themes with the `theme` option or `setTheme`, read the read-only state with `getReadOnly`, and translate it with `messages.ui` and `messages.schema`.

Also adds the `renameKey` edit operation (`{ op: 'renameKey', at, key }`), which renames a map key in place and keeps its position and comments, and the `EditorTheme`, `ResolvedTheme` and `EditorMessages` types.

Breaking for code written against earlier 0.x types: `NodeRef`, `TextChange`, `YamlProblem`, `EditOp`, `EditResult` and the `ManifestEditorOptions` fields are now `readonly`, and the `onChange`, `onProblemsChange` and `onModeChange` options are function properties.
