import type { NodeRef, ParsedText } from '../document/types.js';
import type { EditorContext } from '../editor/context.js';
import { resolveAt } from '../engine/resolve.js';
import { guideField, kindKey } from '../formats/guide.js';
import { isRecord, safeData } from './util.js';

/**
 * Builds the label lookup for one render of `parsed`: the guide label of a map key (through the
 * schema definition of its parent), the guide label of a document's kind (called with `path: []`
 * and the kind as `key`), or the key itself when there is none.
 * @internal
 */
export function makeLabelFor(ctx: EditorContext, parsed: ParsedText): (ref: NodeRef, key: string) => string {
  const data = new Map<number, unknown>();
  const dataOf = (doc: number): unknown => {
    if (!data.has(doc)) {
      data.set(doc, safeData(parsed, doc));
    }
    return data.get(doc);
  };
  return (ref, key) => {
    const guide = ctx.guide();
    const d = dataOf(ref.doc);
    if (ref.path.length === 0) {
      const apiVersion = isRecord(d) ? d['apiVersion'] : undefined;
      return typeof apiVersion === 'string' ? (guide.kinds[kindKey(apiVersion, key)]?.label ?? key) : key;
    }
    const bundle = ctx.bundleFor(ref.doc);
    if (!bundle) return key;
    try {
      const parent = resolveAt(bundle, ref.path.slice(0, -1), d);
      return guideField(guide, parent?.defName, key)?.label ?? key;
    } catch {
      return key;
    }
  };
}
