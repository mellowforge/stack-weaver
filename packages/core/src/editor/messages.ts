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
  /** Fallback name of a sequence item; the item number follows. */
  item: string;
  /** Fallback name of a document without a kind; the document number follows. */
  document: string;
  /** Accessible name of the outline tree. */
  outlineLabel: string;
  /** Shown in the visual pane while there is nothing to show. */
  visualEmpty: string;
  /** Banner shown while the YAML cannot be parsed. */
  bannerBroken: string;
  /** Button in the banner that moves to the first YAML error. */
  jumpToError: string;
  /** Card text for a document whose kind has no schema. */
  unknownKind: string;
  /** Button that moves to the part in the code editor. */
  editInCode: string;
  /** Note on a part that cannot be edited visually. */
  readOnlyNode: string;
  /** Badge on a field the schema requires. */
  required: string;
  /** Accessible name of the button that removes a field or item; `{label}` is replaced by its name. */
  removeField: string;
  /** Note on a value that is anchored, so editing it changes every alias of it. */
  aliasNote: string;
  /** Note on a field the schema does not know. */
  unknownField: string;
  /** Text of the button that opens a nested part of the document; `{label}` is replaced by its name. */
  openSection: string;
  /** Shown when a typed value is not a number. */
  invalidNumber: string;
  /** Shown when a typed value is not a whole number. */
  invalidInteger: string;
  /** Shown when a typed value is not a valid resource quantity. */
  invalidQuantity: string;
  /** Shown when the edit cannot be made visually. */
  editRefused: string;
  /** Text of the button that adds an item to a list. */
  addItem: string;
  /** Text of the button that adds an entry to a key-value list. */
  addEntry: string;
  /** Accessible name of the key input of a key-value list. */
  entryKey: string;
  /** Accessible name of the value input of a key-value list. */
  entryValue: string;
  /** Accessible name of the input that holds a new list item. */
  newItem: string;
  /** Shown when renaming a key to one that already exists. */
  keyExists: string;
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
  item: 'Item',
  document: 'Document',
  outlineLabel: 'Outline',
  visualEmpty: 'Nothing to show yet. Start from a template or write YAML in code.',
  bannerBroken: 'The YAML has errors. The visual editor shows the last valid version and is read-only until they are fixed.',
  jumpToError: 'Jump to error',
  unknownKind: 'Unknown kind, edit in code',
  editInCode: 'Edit in code',
  readOnlyNode: 'This part cannot be edited visually.',
  required: 'Required',
  removeField: 'Remove {label}',
  aliasNote: 'This value is shared: changing it changes every alias of it.',
  unknownField: 'Not in the schema, so it is read-only here.',
  openSection: 'Open {label}',
  invalidNumber: 'Enter a number.',
  invalidInteger: 'Enter a whole number.',
  invalidQuantity: 'Enter a quantity such as 500m, 2 or 1Gi.',
  editRefused: 'This value cannot be changed here. Edit it in code.',
  addItem: 'Add',
  addEntry: 'Add',
  entryKey: 'Key',
  entryValue: 'Value',
  newItem: 'New item',
  keyExists: 'That key already exists.',
};
