import type { EditOp, EditResult } from '../../document/edit.js';
import type { DocumentStore } from '../../document/store.js';
import type { NodeRef } from '../../document/types.js';
import type { WidgetContext } from './types.js';

/** The undo-group key of a visual edit at `ref`: consecutive edits with the same key merge into one step. */
export const groupKey = (ref: NodeRef): string => `visual:${ref.doc}:${ref.path.join('/')}`;

/**
 * Builds the {@link WidgetContext} of one field over `store`.
 * @internal
 */
export function createWidgetContext(
  store: DocumentStore,
  init: Omit<WidgetContext, 'parsed' | 'commit' | 'edit'>,
  isReadOnly: () => boolean = () => init.readOnly,
): WidgetContext {
  const edit = (op: EditOp, opts?: { group?: string }): EditResult => {
    if (isReadOnly()) return { ok: false, reason: 'unsupported' };
    const group = opts?.group ?? (op.op === 'set' ? groupKey(op.at) : undefined);
    return store.edit(op, group === undefined ? undefined : { group });
  };
  return {
    ...init,
    parsed: () => store.parsed,
    commit(value) {
      const r = edit({ op: 'set', at: init.ref, value });
      return r.ok ? undefined : r.reason;
    },
    edit,
  };
}
