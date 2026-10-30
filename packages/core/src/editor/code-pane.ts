import type { StoreEvent } from '../document/store.js';
import type { NodeRef, TextRange } from '../document/types.js';
import type { CodeEditorAdapter, CodeEditorInstance } from '../editors/adapter.js';
import { rangeForRef } from './context.js';
import type { EditorContext, Pane } from './context.js';

/**
 * The code pane: a {@link Pane} that mounts a code editor adapter into the shell's code element.
 * @internal
 */
export interface CodePane extends Pane {
  /** Resolves once the adapter is mounted (or the pane was destroyed first). */
  readonly ready: Promise<void>;
  /** The mounted instance, if any. */
  instance(): CodeEditorInstance | undefined;
  /** Reveals and selects `range`. */
  revealRange(range: TextRange): void;
}

/**
 * Mounts the adapter into `el` and keeps it in step with the store: the user's typing goes to
 * `store.setText(.., 'code')` synchronously; every other change is applied as one splice.
 * @internal
 */
export function createCodePane(
  ctx: EditorContext,
  o: {
    el: HTMLElement;
    adapter: Promise<CodeEditorAdapter>;
    theme(): 'light' | 'dark';
    onUndo(): void;
    onRedo(): void;
  },
): CodePane {
  let inst: CodeEditorInstance | undefined;
  let destroyed = false;

  const ready = o.adapter.then((adapter) => {
    if (destroyed) return;
    inst = adapter.mount(o.el, {
      text: ctx.store.text,
      readOnly: ctx.readOnly(),
      theme: o.theme(),
      ariaLabel: ctx.messages.ui.codeLabel,
      onChange: (t) => ctx.store.setText(t, 'code'),
      onUndo: o.onUndo,
      onRedo: o.onRedo,
    });
  });

  return {
    el: o.el,
    ready,
    instance: () => inst,
    update(e: StoreEvent | null) {
      if (!inst) return;
      if (e && e.origin !== 'code') inst.applyChange(e.change);
      // Safety net: the editor must already match the store here; never expected to run.
      const text = inst.getText();
      if (text !== ctx.store.text) inst.applyChange({ from: 0, to: text.length, insert: ctx.store.text });
    },
    reveal(ref: NodeRef) {
      const r = rangeForRef(ctx.store.parsed, ref);
      if (!r || !inst) return false;
      inst.reveal(r, { select: true });
      return true;
    },
    revealRange(range) {
      inst?.reveal(range, { select: true });
    },
    setReadOnly(v) {
      inst?.setReadOnly(v);
    },
    destroy() {
      destroyed = true;
      inst?.destroy();
      inst = undefined;
    },
  };
}
