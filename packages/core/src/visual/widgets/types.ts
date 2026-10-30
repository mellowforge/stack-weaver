import type { EditOp, EditRefusal, EditResult } from '../../document/edit.js';
import type { NodeRef, ParsedText, ScalarValue, YamlValue } from '../../document/types.js';
import type { UiMessages } from '../../editor/messages.js';
import type { JsonSchema } from '../../formats/types.js';

/** What a widget is built from: the field it edits and the ways to change it. */
export interface WidgetContext {
  /** A unique DOM id. The widget gives its main control this id, so the row's `<label for>` names it. */
  readonly id: string;
  /** The field's display label. */
  readonly label: string;
  /** The field's description; empty when there is none. */
  readonly description: string;
  /** The node the widget edits. */
  readonly ref: NodeRef;
  /** The value when the widget was built; `update` delivers later ones. */
  readonly value: YamlValue;
  /** The resolved schema of the field. */
  readonly schema: JsonSchema;
  /** True when the widget was built read-only; `update` delivers later changes. */
  readonly readOnly: boolean;
  /** The part after the colon of a guide widget such as `"name:param"`. */
  readonly param?: string;
  /** The guide's suggested values for the field (`GuideField.options`), for widgets that offer them. */
  readonly options?: readonly string[];
  /** The editor's UI strings. */
  readonly messages: UiMessages;
  /** The current parse, for widgets that suggest values from the document. */
  parsed(): ParsedText;
  /**
   * Sets the node to `value`. Consecutive commits to one node form one undo step.
   * @returns The reason the edit was refused, or `undefined` when it was made.
   */
  commit(value: ScalarValue): EditRefusal | undefined;
  /**
   * Applies an edit to the document (for composite widgets). A `set` joins the undo group of its
   * node unless `opts.group` says otherwise. Refused with `unsupported` while the field is read-only.
   */
  edit(op: EditOp, opts?: { group?: string }): EditResult;
}

/** A mounted widget. */
export interface WidgetInstance {
  /** The widget's root element. */
  readonly el: HTMLElement;
  /** Shows the current value; must not disturb a focused control that already shows it. */
  update(value: YamlValue, readOnly: boolean): void;
  /** Moves focus to the widget's main control. */
  focus(): void;
  /** Releases the widget. */
  destroy?(): void;
}

/**
 * Builds a widget for a field.
 *
 * A factory for a mapping may carry `managesKeys: true` to say that the widget adds, shows and
 * removes the mapping's keys itself. The mapping is then not an outline node or a section of its
 * own: the widget is a row in its parent's section, and no "Add key" is offered for the mapping.
 */
export type WidgetFactory = ((ctx: WidgetContext) => WidgetInstance) & {
  /** True when the widget manages the keys of its mapping: it is a row in the parent's section, with no outline node and no "Add key" for the mapping. */
  readonly managesKeys?: boolean;
};

/** Widget factories by name. A guide's `widget` names one of these. */
export type WidgetRegistry = Readonly<Record<string, WidgetFactory>>;
