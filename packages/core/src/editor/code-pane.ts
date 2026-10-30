import { breadcrumbAt, hoverAt } from '../assist/hover.js';
import { completionsFor } from '../assist/complete.js';
import { cursorContext } from '../assist/context.js';
import { toData } from '../document/data.js';
import { refAtOffset } from '../document/paths.js';
import type { StoreEvent } from '../document/store.js';
import type { NodeRef, TextRange } from '../document/types.js';
import type { CodeCompletionResult, CodeDiagnostic, CodeEditorAdapter, CodeEditorInstance } from '../editors/adapter.js';
import type { Problem } from '../validation/problems.js';
import { rangeForRef } from './context.js';
import type { EditorContext, Pane } from './context.js';
import { h } from './dom.js';

/**
 * The code pane: a {@link Pane} that mounts a code editor adapter into the shell's code element.
 * @internal
 */
export interface CodePane extends Pane {
  /**
   * Resolves once the adapter is mounted (or the pane was destroyed first). Rejects when the
   * adapter fails to load or mount, after logging it and showing `codeEditorFailed` in the pane.
   */
  readonly ready: Promise<void>;
  /** The mounted instance, if any. */
  instance(): CodeEditorInstance | undefined;
  /** Reveals and selects `range`. */
  revealRange(range: TextRange): void;
  /** Shows `problems` as markers in the code editor (also applied when the editor mounts later). */
  setProblems(problems: readonly Problem[]): void;
}

/**
 * Mounts the adapter into `el` and keeps it in step with the store: the user's typing goes to
 * `store.setText(.., 'code')` synchronously; every other change is applied as one splice.
 * Also supplies completions and hover from the assist engine, and shows the breadcrumb of the caret.
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
  const ui = ctx.messages.ui;
  let inst: CodeEditorInstance | undefined;
  let destroyed = false;
  let diagnostics: readonly CodeDiagnostic[] = [];

  const crumb = h(o.el.ownerDocument, 'nav', { class: 'sw-breadcrumb', 'aria-label': ui.breadcrumbLabel });
  const showCrumb = (at: number): void => {
    let parts: readonly string[] = [];
    try {
      parts = breadcrumbAt(ctx.store.parsed, at);
    } catch {
      // The breadcrumb is a convenience; a document it cannot read shows nothing.
    }
    crumb.textContent = parts.join(' › ');
  };

  const complete = async (text: string, offset: number): Promise<CodeCompletionResult | null> => {
    const format = ctx.format();
    const cc = cursorContext(text, offset);
    if (!format || !cc) return null;
    const bundle = await ctx.loadBundle(cc.doc);
    // The text moved on while the schema loaded: this answer would be for an older document.
    if (destroyed || ctx.store.text !== text) return null;
    const { store } = ctx;
    const parsed = store.parsed.ok ? store.parsed : (store.lastGood ?? store.parsed);
    let data: unknown;
    try {
      data = toData(parsed, cc.doc);
    } catch {
      data = undefined;
    }
    const options = completionsFor({
      ctx: cc,
      eol: parsed.eol,
      bundle,
      guide: ctx.guide(),
      data,
      kinds: format.kinds(),
      tierLabels: { recommended: ui.tierRecommended, common: ui.tierCommon, advanced: ui.tierAdvanced },
    });
    return options.length > 0 ? { from: cc.from, options } : null;
  };

  const hover = (text: string, offset: number): ReturnType<typeof hoverAt> => {
    if (ctx.store.text !== text) return undefined;
    try {
      const parsed = ctx.store.parsed;
      const doc = refAtOffset(parsed, offset)?.doc;
      if (doc === undefined) return undefined;
      const bundle = ctx.bundleFor(doc);
      if (!bundle) void ctx.loadBundle(doc); // the next hover will have it
      return hoverAt(parsed, offset, bundle, ctx.guide());
    } catch {
      return undefined;
    }
  };

  const ready = o.adapter.then((adapter) => {
    if (destroyed) return;
    inst = adapter.mount(o.el, {
      text: ctx.store.text,
      readOnly: ctx.readOnly(),
      theme: o.theme(),
      ariaLabel: ui.codeLabel,
      onChange: (t) => ctx.store.setText(t, 'code'),
      onUndo: o.onUndo,
      onRedo: o.onRedo,
      onSelectionChange: (r) => showCrumb(r.from),
      complete: (text, offset) => complete(text, offset),
      hover,
    });
    o.el.append(crumb);
    inst.setDiagnostics(diagnostics);
    showCrumb(inst.getSelection().from);
  }).catch((err: unknown) => {
    if (destroyed) return; // nobody is left to tell
    // The adapter did not load or did not mount: say so in the pane instead of leaving it blank.
    const failed = inst;
    inst = undefined;
    try {
      failed?.destroy();
    } catch {
      // Already broken; the pane is cleared below either way.
    }
    console.error('stack-weaver: the code editor failed to load', err);
    o.el.replaceChildren(h(o.el.ownerDocument, 'p', { class: 'sw-field-error sw-pane-error', role: 'alert' }, [ui.codeEditorFailed]));
    throw err;
  });

  return {
    el: o.el,
    ready,
    instance: () => inst,
    update(e: StoreEvent | null) {
      if (!inst) return;
      if (e && e.origin !== 'code') inst.applyChange(e.change);
      // Safety net: the editor must already match the store here. It is never expected to run, so
      // it logs: a full replace loses the caret and hides an adapter bug.
      const text = inst.getText();
      if (text !== ctx.store.text) {
        console.error('stack-weaver: code editor out of sync with the store', { editorLength: text.length, storeLength: ctx.store.text.length });
        inst.applyChange({ from: 0, to: text.length, insert: ctx.store.text });
      }
      showCrumb(inst.getSelection().from);
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
    setProblems(problems) {
      diagnostics = problems.map((p) => ({ from: p.from, to: p.to, severity: p.severity, message: p.message }));
      inst?.setDiagnostics(diagnostics);
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
