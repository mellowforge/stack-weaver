---
"@stack-weaver/core": minor
---

Controller change signals for the framework wrappers.

Added:
- `onFormatChange(activeFormat)` option: called with the resolved format id when it changes.
- `onHistoryChange({ canUndo, canRedo })` option: called when either history flag changes.
- Controller methods `canUndo()`, `canRedo()`, `clearHistory()` and `reset(text)`.
- `StoreEvent.step`: on `'history'` events, the origin of the undone or redone step.

Changed:
- Under `format: 'auto'`, undo and redo re-detect the format only for steps made through the API; undoing or redoing typed text keeps the format.
- `defaultWidgets` and `defaultUiMessages` are now frozen.
