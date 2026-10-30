import { HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * YAML syntax colours, taken from the `--sw-*` tokens so they follow the theme. CodeMirror's
 * `defaultHighlightStyle` is light-only (its keys are `#00f`, unreadable on the dark background).
 */
export const swHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--sw-accent)' },
  { tag: [t.attributeValue, t.special(t.string), t.number, t.bool, t.null], color: 'var(--sw-info)' },
  { tag: [t.labelName, t.typeName, t.keyword], color: 'var(--sw-warning)' },
  { tag: [t.comment, t.lineComment, t.meta], color: 'var(--sw-muted)' },
  { tag: t.comment, fontStyle: 'italic' },
]);
