import type { PluralMessage } from './format-message.js';

/** The editor's own UI strings. Pass a partial table as `messages.ui` to translate or reword them. */
export interface UiMessages {
  /** Accessible name of the whole editor. */
  readonly editorLabel: string;
  /** Accessible name of the mode switch. */
  readonly modeLabel: string;
  /** Label of the visual mode. */
  readonly modeVisual: string;
  /** Label of the split mode. */
  readonly modeSplit: string;
  /** Label of the code mode. */
  readonly modeCode: string;
  /** Label of the undo button. */
  readonly undo: string;
  /** Label of the redo button. */
  readonly redo: string;
  /** Accessible name of the code editing surface. */
  readonly codeLabel: string;
  /** Accessible name of the visual pane. */
  readonly visualLabel: string;
  /** Format badge text while no format is resolved. */
  readonly formatNone: string;
  /** The problem count, by plural category of `messages.locale`; `zero` is used for none and `{count}` is the number. */
  readonly problemCount: PluralMessage;
  /** Heading and accessible name of the problems panel. */
  readonly problemsLabel: string;
  /** Text alternative of the error icon. */
  readonly severityError: string;
  /** Screen-reader prefix of a problem on a field; `{severity}` is the severity text. */
  readonly problemPrefix: string;
  /** Text alternative of the warning icon. */
  readonly severityWarning: string;
  /** Text alternative of the information icon. */
  readonly severityInfo: string;
  /** Accessible name of the breadcrumb that shows where the caret is. */
  readonly breadcrumbLabel: string;
  /** Accessible name of the path to the shown section in the visual pane (distinct from the code breadcrumb). */
  readonly sectionPathLabel: string;
  /** Heading of the starter recipes. */
  readonly recipesTitle: string;
  /** Label of the button that skips the recipes. */
  readonly recipesBlank: string;
  /** Completion section name for recommended items. */
  readonly tierRecommended: string;
  /** Completion section name for common items. */
  readonly tierCommon: string;
  /** Completion section name for advanced items. */
  readonly tierAdvanced: string;
  /** Fallback name of a sequence item; `{n}` is its 1-based number. */
  readonly itemLabel: string;
  /** Fallback name of a document without a kind; `{n}` is its 1-based number. */
  readonly documentLabel: string;
  /** Accessible name of the outline tree. */
  readonly outlineLabel: string;
  /** Shown in the visual pane while there is nothing to show. */
  readonly visualEmpty: string;
  /** Banner shown while the YAML cannot be parsed. */
  readonly bannerBroken: string;
  /** Button in the banner that moves to the first YAML error. */
  readonly jumpToError: string;
  /** Card text for a document whose kind has no schema. */
  readonly unknownKind: string;
  /** Button that moves to the part in the code editor. */
  readonly editInCode: string;
  /** Note on a part that cannot be edited visually. */
  readonly readOnlyNode: string;
  /** Badge on a field the schema requires. */
  readonly required: string;
  /** Accessible name of the button that removes a field or item; `{label}` is replaced by its name. */
  readonly removeField: string;
  /** Note on a value that is anchored, so editing it changes every alias of it. */
  readonly aliasNote: string;
  /** Note on a field the schema does not know. */
  readonly unknownField: string;
  /** Text of the button that opens a nested part of the document; `{label}` is replaced by its name. */
  readonly openSection: string;
  /** Shown when a typed value is not a number. */
  readonly invalidNumber: string;
  /** Shown when a typed value is not a whole number. */
  readonly invalidInteger: string;
  /** Shown when a typed value is not a valid resource quantity. */
  readonly invalidQuantity: string;
  /** Shown when the edit cannot be made visually. */
  readonly editRefused: string;
  /** Text of the button that adds an item to a list. */
  readonly addItem: string;
  /** Text of the button that adds an entry to a key-value list. */
  readonly addEntry: string;
  /** Accessible name of the key input that adds an entry to a key-value list; `{label}` is the list's name. */
  readonly entryKeyLabel: string;
  /** Accessible name of the value input that adds an entry to a key-value list; `{label}` is the list's name. */
  readonly entryValueLabel: string;
  /** Accessible name of the key input of an existing entry; `{label}` is the list's name, `{name}` the entry's key. */
  readonly namedEntryKeyLabel: string;
  /** Accessible name of the value input of an existing entry; `{label}` is the list's name, `{name}` the entry's key. */
  readonly namedEntryValueLabel: string;
  /** Accessible name of the input that holds a new list item; `{label}` is the list's name. */
  readonly newItemLabel: string;
  /** Accessible name of the button that adds an item to a list; `{label}` is the list's name. */
  readonly addItemLabel: string;
  /** Accessible name of the button that adds an entry to a key-value list; `{label}` is the list's name. */
  readonly addEntryLabel: string;
  /** Text of the problems panel toggle; `{label}` is `problemsLabel`, `{count}` the problem count text. */
  readonly problemsSummary: string;
  /** Shown when renaming a key to one that already exists. */
  readonly keyExists: string;
  /** Accessible name of the region that adds fields, keys or items to a section. */
  readonly addSlotLabel: string;
  /** Text of the disclosure that shows advanced fields. */
  readonly showAdvanced: string;
  /** Text of the disclosure that hides advanced fields. */
  readonly hideAdvanced: string;
  /** Text of the button that adds a new key to a key-value section. */
  readonly addKey: string;
  /** Accessible name of the input for a new key's name. */
  readonly newKeyName: string;
  /** Text of the button that adds an item to a list section. */
  readonly addListItem: string;
  /** Text of the button that opens the resource picker. */
  readonly addResource: string;
  /** Heading and accessible name of the resource picker. */
  readonly pickerTitle: string;
  /** Accessible name of the picker's search box. */
  readonly pickerSearch: string;
  /** Accessible name of the picker's close button. */
  readonly pickerClose: string;
  /** Shown when no resource kind matches the search. */
  readonly pickerEmpty: string;
  /** Shown when the chosen resource kind could not be loaded. */
  readonly pickerLoadFailed: string;
  /** Text of the button that removes the shown section. */
  readonly removeSection: string;
  /** Question asked before removing a section; `{label}` is replaced by its name. */
  readonly confirmRemove: string;
  /** Text of the button that confirms a removal. */
  readonly confirmYes: string;
  /** Text of the button that cancels a removal. */
  readonly confirmNo: string;
  /** Warning on a Secret value that is not base64-encoded UTF-8 text; it is shown as stored and cannot be edited visually. */
  secretInvalidBase64: string;
  /** Warning on a Secret value whose text has a carriage return, which cannot be edited visually without changing it. */
  readonly secretCarriageReturn: string;
  /** Shown in the code pane when the code editor could not be loaded or mounted. */
  readonly codeEditorFailed: string;
  /** Format badge text, and the visual pane's empty message, when the built-in formats could not be loaded. */
  readonly formatsFailed: string;
  /** Note on a section whose schema could not be loaded, so its fields are read-only. */
  readonly schemaFailed: string;
  /** Note on a field whose input widget failed, so it is shown read-only. */
  readonly widgetFailed: string;
  /** Heading of the Variables section and its outline entry. */
  readonly variables: string;
  /** Text of the button that adds a variable. */
  readonly addVariable: string;
  /** Label of a variable's name input. */
  readonly variableName: string;
  /** Label of a variable's type select. */
  readonly variableType: string;
  /** Label of a variable's default value control. */
  readonly variableDefault: string;
  /** Label of the input that lists the allowed values of a one-of-a-list variable. */
  readonly variableEnumValues: string;
  /** Label of a variable's description input. */
  readonly variableDescription: string;
  /** Text and accessible name of the button that removes a variable; `{name}` is replaced by its name. */
  readonly removeVariable: string;
  /** Shown when a variable name is not a valid name. */
  readonly variableNameInvalid: string;
  /** Shown when renaming a variable to a name that is taken; `{name}` is replaced by it. */
  readonly variableNameTaken: string;
  /** Shown while there are no variables. */
  readonly variablesEmpty: string;
  /** Label of the text variable type. */
  readonly variableTypeString: string;
  /** Label of the number variable type. */
  readonly variableTypeNumber: string;
  /** Label of the yes/no variable type. */
  readonly variableTypeBoolean: string;
  /** Label of the port variable type. */
  readonly variableTypePort: string;
  /** Label of the one-of-a-list variable type. */
  readonly variableTypeEnum: string;
  /** Shown when the allowed values of a one-of-a-list variable are left empty. */
  readonly variableEnumValuesRequired: string;
  /** Announced when a type change removes the variable's default because it no longer fits; `{value}` is the removed default. */
  readonly variableDefaultDropped: string;
  /** Accessible name of the button that switches a field between its own value and a variable. */
  readonly useVariable: string;
  /** Accessible name of the variable select of a field; `{label}` is replaced by the field's label. */
  readonly variableSelect: string;
  /** Shown instead of the variable select when no variable fits the field. */
  readonly variableNone: string;
  /** Option for a referenced variable that is not declared or does not fit the field; `{name}` is replaced by it. */
  readonly variableUndeclared: string;
  /** Heading of the variable names offered as code completions. */
  readonly variableCompletion: string;
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
  problemCount: { zero: 'No problems', one: '{count} problem', other: '{count} problems' },
  problemsLabel: 'Problems',
  problemPrefix: '{severity}: ',
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
  itemLabel: 'Item {n}',
  documentLabel: 'Document {n}',
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
  entryKeyLabel: '{label}, Key',
  entryValueLabel: '{label}, Value',
  namedEntryKeyLabel: '{label}, {name}, Key',
  namedEntryValueLabel: '{label}, {name}, Value',
  newItemLabel: '{label} New item',
  addItemLabel: 'Add {label}',
  addEntryLabel: 'Add {label}',
  problemsSummary: '{label}: {count}',
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
  variableEnumValuesRequired: 'List at least one value.',
  variableDefaultDropped: 'The default {value} does not fit the new type and was removed.',
  useVariable: 'Use variable',
  variableSelect: 'Variable for {label}',
  variableNone: 'No variables of this type yet. Add one under Variables.',
  variableUndeclared: '{name} (not declared)',
  variableCompletion: 'Variables',
};
