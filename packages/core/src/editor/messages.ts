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
  /** Problem count when there are none. */
  problemsNone: string;
  /** Problem count when there is one. */
  problemsOne: string;
  /** Problem count for several; `{count}` is replaced by the number. */
  problemsMany: string;
  /** Heading and accessible name of the problems panel. */
  problemsLabel: string;
  /** Text alternative of the error icon. */
  severityError: string;
  /** Text alternative of the warning icon. */
  severityWarning: string;
  /** Text alternative of the information icon. */
  severityInfo: string;
  /** Accessible name of the breadcrumb that shows where the caret is. */
  breadcrumbLabel: string;
  /** Heading of the starter recipes. */
  recipesTitle: string;
  /** Label of the button that skips the recipes. */
  recipesBlank: string;
  /** Completion section name for recommended items. */
  tierRecommended: string;
  /** Completion section name for common items. */
  tierCommon: string;
  /** Completion section name for advanced items. */
  tierAdvanced: string;
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
  problemsNone: 'No problems',
  problemsOne: '1 problem',
  problemsMany: '{count} problems',
  problemsLabel: 'Problems',
  severityError: 'Error',
  severityWarning: 'Warning',
  severityInfo: 'Information',
  breadcrumbLabel: 'Location',
  recipesTitle: 'Start from a template',
  recipesBlank: 'Start blank',
  tierRecommended: 'Recommended',
  tierCommon: 'Common',
  tierAdvanced: 'Advanced',
};
