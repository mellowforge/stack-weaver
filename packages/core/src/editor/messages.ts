/** The editor's own UI strings. Pass a partial table as `messages.ui` to translate or reword them. */
export interface UiMessages {
  /** Accessible name of the whole editor. */
  editorLabel: string;
  /** Accessible name of the mode switch. */
  modeLabel: string;
  /** Label of the visual mode. */
  modeVisual: string;
  /** Label of the split mode. */
  modeSplit: string;
  /** Label of the code mode. */
  modeCode: string;
  /** Label of the undo button. */
  undo: string;
  /** Label of the redo button. */
  redo: string;
  /** Accessible name of the code editing surface. */
  codeLabel: string;
  /** Accessible name of the visual pane. */
  visualLabel: string;
  /** Format badge text while no format is resolved. */
  formatNone: string;
}

/** The English UI strings. */
export const defaultUiMessages: UiMessages = {
  editorLabel: 'Manifest editor',
  modeLabel: 'Editor mode',
  modeVisual: 'Visual',
  modeSplit: 'Split',
  modeCode: 'Code',
  undo: 'Undo',
  redo: 'Redo',
  codeLabel: 'YAML code',
  visualLabel: 'Visual editor',
  formatNone: 'No format',
};
