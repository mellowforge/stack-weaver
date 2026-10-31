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
  /** Accessible name of the path to the shown section in the visual pane (distinct from the code breadcrumb). */
  sectionPathLabel: string;
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
  /** Accessible name of the region that adds fields, keys or items to a section. */
  addSlotLabel: string;
  /** Text of the disclosure that shows advanced fields. */
  showAdvanced: string;
  /** Text of the disclosure that hides advanced fields. */
  hideAdvanced: string;
  /** Text of the button that adds a new key to a key-value section. */
  addKey: string;
  /** Accessible name of the input for a new key's name. */
  newKeyName: string;
  /** Text of the button that adds an item to a list section. */
  addListItem: string;
  /** Text of the button that opens the resource picker. */
  addResource: string;
  /** Heading and accessible name of the resource picker. */
  pickerTitle: string;
  /** Accessible name of the picker's search box. */
  pickerSearch: string;
  /** Accessible name of the picker's close button. */
  pickerClose: string;
  /** Shown when no resource kind matches the search. */
  pickerEmpty: string;
  /** Shown when the chosen resource kind could not be loaded. */
  pickerLoadFailed: string;
  /** Text of the button that removes the shown section. */
  removeSection: string;
  /** Question asked before removing a section; `{label}` is replaced by its name. */
  confirmRemove: string;
  /** Text of the button that confirms a removal. */
  confirmYes: string;
  /** Text of the button that cancels a removal. */
  confirmNo: string;
  /** Warning on a Secret value that is not base64-encoded UTF-8 text; it is shown as stored and cannot be edited visually. */
  secretInvalidBase64: string;
  /** Warning on a Secret value whose text has a carriage return, which cannot be edited visually without changing it. */
  secretCarriageReturn: string;
  /** Shown in the code pane when the code editor could not be loaded or mounted. */
  codeEditorFailed: string;
  /** Format badge text, and the visual pane's empty message, when the built-in formats could not be loaded. */
  formatsFailed: string;
  /** Note on a section whose schema could not be loaded, so its fields are read-only. */
  schemaFailed: string;
  /** Note on a field whose input widget failed, so it is shown read-only. */
  widgetFailed: string;
  /** Heading of the Variables section and its outline entry. */
  variables: string;
  /** Text of the button that adds a variable. */
  addVariable: string;
  /** Label of a variable's name input. */
  variableName: string;
  /** Label of a variable's type select. */
  variableType: string;
  /** Label of a variable's default value control. */
  variableDefault: string;
  /** Label of the input that lists the allowed values of a one-of-a-list variable. */
  variableEnumValues: string;
  /** Label of a variable's description input. */
  variableDescription: string;
  /** Text and accessible name of the button that removes a variable; `{name}` is replaced by its name. */
  removeVariable: string;
  /** Shown when a variable name is not a valid name. */
  variableNameInvalid: string;
  /** Shown when renaming a variable to a name that is taken; `{name}` is replaced by it. */
  variableNameTaken: string;
  /** Shown while there are no variables. */
  variablesEmpty: string;
  /** Label of the text variable type. */
  variableTypeString: string;
  /** Label of the number variable type. */
  variableTypeNumber: string;
  /** Label of the yes/no variable type. */
  variableTypeBoolean: string;
  /** Label of the port variable type. */
  variableTypePort: string;
  /** Label of the one-of-a-list variable type. */
  variableTypeEnum: string;
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
  sectionPathLabel: 'Section path',
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
  addSlotLabel: 'Add to this section',
  showAdvanced: 'Show advanced',
  hideAdvanced: 'Hide advanced',
  addKey: 'Add key',
  newKeyName: 'New key name',
  addListItem: 'Add item',
  addResource: '+ Add resource',
  pickerTitle: 'Add resource',
  pickerSearch: 'Search resource kinds',
  pickerClose: 'Close',
  pickerEmpty: 'No resource kinds match.',
  pickerLoadFailed: 'That resource could not be added.',
  removeSection: 'Remove section',
  confirmRemove: 'Remove {label}?',
  confirmYes: 'Remove',
  confirmNo: 'Cancel',
  secretInvalidBase64: 'This value is not base64-encoded text, so it is shown as stored and cannot be edited here.',
  secretCarriageReturn: 'This value has Windows line endings, so it is shown as is and cannot be edited here without changing them.',
  codeEditorFailed: 'The code editor could not be loaded. Reload the page to try again.',
  formatsFailed: 'Formats could not be loaded',
  schemaFailed: 'Schema could not be loaded; fields are read-only here.',
  widgetFailed: 'This field’s input failed, so it is shown read-only.',
  variables: 'Variables',
  addVariable: 'Add variable',
  variableName: 'Name',
  variableType: 'Type',
  variableDefault: 'Default',
  variableEnumValues: 'Allowed values (comma-separated)',
  variableDescription: 'Description',
  removeVariable: 'Remove variable {name}',
  variableNameInvalid: 'Use letters, digits and _, starting with a letter or _.',
  variableNameTaken: 'A variable named {name} already exists.',
  variablesEmpty: 'No variables yet. Variables keep values like ports and tags in one place; fields refer to them as ${NAME}.',
  variableTypeString: 'Text',
  variableTypeNumber: 'Number',
  variableTypeBoolean: 'Yes/No',
  variableTypePort: 'Port',
  variableTypeEnum: 'One of a list',
};
