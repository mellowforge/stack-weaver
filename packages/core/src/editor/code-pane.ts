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
import type { ResolvedTheme } from './theme.js';

/** The text before the caret ends in `${` and the part of a variable name typed so far. */
const VARIABLE_PREFIX = /\$\{([A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * The code pane: a {@link Pane} that mounts a code editor adapter into the shell's code element.
 * @internal
 */
export interface CodePane extends Pane {
  /**
   * Resolves once the adapter is mounted (an asynchronous mount included; or the pane was destroyed
   * first). Rejects when the adapter fails to load or mount (a throw and a rejected promise alike),
   * after logging it and showing `codeEditorFailed` in the pane.
   */
  readonly ready: Promise<void>;
  /** The mounted instance, if any. */
  instance(): CodeEditorInstance | undefined;
  /** Reveals and selects `range`; while the editor is still mounting, the last request is applied on arrival. */
  revealRange(range: TextRange): void;
  /**
   * Shows `problems` as markers in the code editor (also applied when the editor mounts later). A
   * problem's quick fix is offered as an action while the editor is not read-only.
   */
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
    theme(): ResolvedTheme;
    onUndo(): void;
    onRedo(): void;
    /** Called when a diagnostic's fix action was refused, so the editor can say so. */
    onFixRefused(): void;
  },
): CodePane {
  const ui = ctx.messages.ui;
  let inst: CodeEditorInstance | undefined;
  let destroyed = false;
  /** The last reveal asked for before the editor was mounted; applied on arrival. */
  let pendingReveal: TextRange | undefined;
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

  /** Variable names after `${` in a value, for a format with variables. */
  const completeVariable = (text: string, offset: number): CodeCompletionResult | null => {
    const decls = ctx.format()?.variables ? ctx.variables()?.get() : undefined;
    if (!decls || decls.length === 0) return null;
    const lineStart = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
    const before = text.slice(lineStart, offset);
    const m = VARIABLE_PREFIX.exec(before);
    if (!m) return null;
    const lead = before.slice(0, m.index);
    // Only in a value (after `key: ` or `- `), and not in a comment.
    if (/(^|\s)#/.test(lead) || !(/^\s*-\s/.test(lead) || /\S:\s/.test(lead))) return null;
    const typed = m[1] ?? '';
    const closed = text[offset] === '}';
    return {
      from: offset - typed.length,
      options: decls.map((d) => ({
        label: d.name,
        apply: closed ? d.name : `${d.name}}`,
        detail: d.type,
        section: { name: ui.variableCompletion, rank: 0 },
      })),
    };
  };

  const complete = async (text: string, offset: number): Promise<CodeCompletionResult | null> => {
    const variable = completeVariable(text, offset);
    if (variable) return variable;
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

  /** The problems as diagnostics; a fix is offered as an action only while the editor is editable. */
  let shown: readonly Problem[] = [];
  const showDiagnostics = (): void => {
    const editable = !ctx.readOnly();
    diagnostics = shown.map((p) => {
      const { fix } = p;
      return {
        from: p.from,
        to: p.to,
        severity: p.severity,
        message: p.message,
        code: p.code,
        source: p.source,
        ...(fix && editable
          ? {
              actions: [
                {
                  id: fix.id,
                  label: fix.label,
                  apply: () => {
                    if (!ctx.applyFix(p).ok) o.onFixRefused();
                  },
                },
              ],
            }
          : {}),
      };
    });
    inst?.setDiagnostics(diagnostics);
  };

  /** Replaces the editor's text with the store's when they differ; returns whether it did. */
  const replaceIfBehind = (target: CodeEditorInstance): boolean => {
    const text = target.getText();
    if (text === ctx.store.text) return false;
    target.applyChange({ from: 0, to: text.length, insert: ctx.store.text });
    return true;
  };

  const ready = o.adapter.then(async (adapter) => {
    if (destroyed) return;
    const mounted = await Promise.resolve(
      adapter.mount(o.el, {
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
      }),
    );
    if (destroyed) {
      // Destroyed while the mount was pending: release the instance and never call into it otherwise.
      try {
        mounted.destroy();
      } catch {
        // Nobody is left to tell.
      }
      return;
    }
    inst = mounted;
    // Whatever happened while the mount was pending (edits, read-only, theme, problems, reveal) is applied now.
    replaceIfBehind(inst);
    inst.setReadOnly(ctx.readOnly());
    inst.setTheme(o.theme());
    o.el.append(crumb);
    inst.setDiagnostics(diagnostics);
    if (pendingReveal) inst.reveal(pendingReveal, { select: true });
    pendingReveal = undefined;
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
      const editorLength = inst.getText().length;
      if (replaceIfBehind(inst)) {
        console.error('stack-weaver: code editor out of sync with the store', { editorLength, storeLength: ctx.store.text.length });
      }
      showCrumb(inst.getSelection().from);
    },
    reveal(ref: NodeRef) {
      const r = rangeForRef(ctx.store.parsed, ref);
      if (!r || destroyed) return false;
      if (inst) inst.reveal(r, { select: true });
      else pendingReveal = r;
      return true;
    },
    revealRange(range) {
      if (inst) inst.reveal(range, { select: true });
      else if (!destroyed) pendingReveal = range;
    },
    setProblems(problems) {
      shown = problems;
      showDiagnostics();
    },
    setReadOnly(v) {
      inst?.setReadOnly(v);
      showDiagnostics(); // the fix actions come and go with read-only
    },
    destroy() {
      destroyed = true;
      inst?.destroy();
      inst = undefined;
    },
  };
}
