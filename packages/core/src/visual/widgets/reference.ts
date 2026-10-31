import { describeNode } from '../../document/describe.js';
import { referenceOf, suggestKeys, suggestNames } from '../suggest.js';
import { textInput } from './text.js';
import type { WidgetFactory } from './types.js';

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const codec = { parse: (t: string) => ({ value: t }), format: text };

/**
 * A name that refers to another resource (`ref:<kind>`): free text with the names of that kind found
 * in the same text offered as suggestions. A kind the guide's `references` do not list gets none.
 */
export const refWidget: WidgetFactory = (ctx) => {
  const kind = ctx.param;
  return textInput(ctx, codec, () => (kind === undefined ? [] : suggestNames(ctx.parsed(), ctx.guide(), kind)));
};

/**
 * A key of another resource (`ref-key:<kind>`): free text with the keys of the resource named by the
 * sibling field the guide's `references[kind].nameKey` names, offered as suggestions.
 */
export const refKeyWidget: WidgetFactory = (ctx) => {
  const kind = ctx.param;
  return textInput(ctx, codec, () => {
    const reference = kind === undefined ? undefined : referenceOf(ctx.guide(), kind);
    if (kind === undefined || !reference) return [];
    const parsed = ctx.parsed();
    const sibling = { doc: ctx.ref.doc, path: [...ctx.ref.path.slice(0, -1), reference.nameKey] };
    const view = describeNode(parsed, sibling);
    return view?.type === 'scalar' && typeof view.value === 'string' ? suggestKeys(parsed, ctx.guide(), kind, view.value) : [];
  });
};
