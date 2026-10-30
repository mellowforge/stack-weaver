import type { EditOp } from '../../document/edit.js';
import type { DocumentStore } from '../../document/store.js';
import type { NodeRef } from '../../document/types.js';
import type { WidgetContext } from './types.js';

/** The undo-group key of a visual edit at `ref`: consecutive edits with the same key merge into one step. */
export const groupKey = (ref: NodeRef): string => `visual:${ref.doc}:${ref.path.join('/')}`;

/**
 * Builds the {@link WidgetContext} of one field over `store`.
 * @internal
 */
export function createWidgetContext(store: DocumentStore, init: Omit<WidgetContext, 'parsed' | 'commit' | 'edit'>): WidgetContext {
  const edit = (op: EditOp) => store.edit(op, op.op === 'set' ? { group: groupKey(op.at) } : undefined);
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
