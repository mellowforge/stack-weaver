---
"@stack-weaver/core": minor
---

Adds the editor UI. `createManifestEditor(el, options)` mounts a Visual, Split or Code editor over one shared document model, so an edit in either pane shows up in the other and undo and redo span both. The visual pane has an outline tree, schema-driven field widgets (including references between resources and a decoded Secret `data` editor), an "Add resource" picker, starter recipes for an empty document and a banner for broken YAML. The code pane uses a CodeMirror 6 adapter at `@stack-weaver/core/editors/codemirror` (CodeMirror packages and `@lezer/highlight` are peer dependencies; bring your own through the `CodeEditorAdapter` interface). Style it with `@stack-weaver/core/stack-weaver.css` and its `--sw-*` tokens, switch themes with the `theme` option, and translate it with `messages.ui` and `messages.schema`.
