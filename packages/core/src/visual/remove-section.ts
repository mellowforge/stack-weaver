import type { NodeRef } from '../document/types.js';
import type { EditorContext } from '../editor/context.js';
import { h } from '../editor/dom.js';

/**
 * The "Remove section" control of the section header.
 * @internal
 */
export interface RemoveControl {
  /** The control's element: the button, its inline confirmation and an error line. */
  readonly el: HTMLElement;
  /** Points the control at the shown section, or at nothing (`undefined` hides it). */
  setTarget(target: { ref: NodeRef; label: string } | undefined): void;
}

let nextRemove = 0;

/**
 * Removes the shown section: a document root with `deleteDocument`, anything else with `delete`.
 * The button first asks "Remove {label}?" inline, with Remove and Cancel buttons (focus moves to
 * Cancel); nothing is edited until Remove is pressed. After a removal `onRemoved` runs, so the host can move focus. A mapping root (compose) has nothing to remove.
 * @internal
 */
export function createRemoveControl(ctx: EditorContext, doc: Document = document, onRemoved: () => void = () => {}): RemoveControl {
  const ui = ctx.messages.ui;
  const button = h(doc, 'button', { type: 'button', class: 'sw-btn sw-section-remove' }, [ui.removeSection]);
  const question = h(doc, 'span', { class: 'sw-confirm-text', id: `sw-confirm-${nextRemove++}` });
  const yes = h(doc, 'button', { type: 'button', class: 'sw-btn sw-confirm-yes' }, [ui.confirmYes]);
  const no = h(doc, 'button', { type: 'button', class: 'sw-btn sw-confirm-no' }, [ui.confirmNo]);
  const confirm = h(doc, 'div', { class: 'sw-section-confirm', role: 'group', 'aria-labelledby': question.id, hidden: true }, [question, yes, no]);
  const errorEl = h(doc, 'p', { class: 'sw-field-error sw-section-remove-error', role: 'alert' });
  const el = h(doc, 'div', { class: 'sw-section-actions', hidden: true }, [button, confirm, errorEl]);

  let target: { ref: NodeRef; label: string } | undefined;
  let targetId = '';

  const showConfirm = (open: boolean): void => {
    confirm.hidden = !open;
    button.hidden = open;
  };

  button.addEventListener('click', () => {
    if (!target) return;
    errorEl.textContent = '';
    question.textContent = ui.confirmRemove.replace('{label}', target.label);
    showConfirm(true);
    no.focus();
  });
  no.addEventListener('click', () => {
    showConfirm(false);
    button.focus();
  });
  yes.addEventListener('click', () => {
    if (!target || ctx.readOnly()) return;
    const { ref } = target;
    const r = ctx.store.edit(ref.path.length === 0 ? { op: 'deleteDocument', doc: ref.doc } : { op: 'delete', at: ref });
    showConfirm(false);
    if (!r.ok) {
      errorEl.textContent = ui.editRefused;
      button.focus();
    } else onRemoved();
  });

  return {
    el,
    setTarget(next) {
      const format = ctx.format();
      const removable = next !== undefined && (next.ref.path.length > 0 || format?.rootModel === 'documents');
      const id = removable ? `${next.ref.doc}:${next.ref.path.join('/')}` : '';
      if (id !== targetId) {
        targetId = id;
        showConfirm(false);
        errorEl.textContent = '';
      }
      target = removable ? next : undefined;
      el.hidden = !removable;
      button.disabled = ctx.readOnly() || !ctx.store.parsed.ok;
    },
  };
}
