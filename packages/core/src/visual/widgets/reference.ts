import { describeNode } from '../../document/describe.js';
import { suggestKeys, suggestNames } from '../suggest.js';
import type { ReferenceKind } from '../suggest.js';
import { textInput } from './text.js';
import type { WidgetContext, WidgetFactory } from './types.js';

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '');
const codec = { parse: (t: string) => ({ value: t }), format: text };

/** The reference kind named by the widget parameter (`ref:Secret`), or `undefined` for any other. */
const kindOf = (ctx: WidgetContext): ReferenceKind | undefined => (ctx.param === 'Secret' || ctx.param === 'ConfigMap' ? ctx.param : undefined);

/**
 * A name that refers to another resource (`ref:Secret`, `ref:ConfigMap`): free text with the
 * names of that kind found in the same text offered as suggestions.
 */
export const refWidget: WidgetFactory = (ctx) => {
  const kind = kindOf(ctx);
  return textInput(ctx, codec, () => (kind ? suggestNames(ctx.parsed(), kind) : []));
};

/**
 * A key of another resource (`ref-key:Secret`, `ref-key:ConfigMap`): free text with the keys of the
 * resource named by the sibling `name` offered as suggestions.
 */
export const refKeyWidget: WidgetFactory = (ctx) => {
  const kind = kindOf(ctx);
  const sibling = { doc: ctx.ref.doc, path: [...ctx.ref.path.slice(0, -1), 'name'] };
  return textInput(ctx, codec, () => {
    if (!kind) return [];
    const parsed = ctx.parsed();
    const view = describeNode(parsed, sibling);
    return view?.type === 'scalar' && typeof view.value === 'string' ? suggestKeys(parsed, kind, view.value) : [];
  });
};
