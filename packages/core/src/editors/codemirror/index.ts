import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  hoverTooltip,
  keymap,
  lineNumbers,
  type Tooltip,
} from '@codemirror/view';
import type { CodeCompletion } from '../../assist/complete.js';
import type { CodeDiagnostic, CodeEditorAdapter, CodeEditorInit, CodeEditorInstance } from '../adapter.js';

/** Options for {@link codemirrorAdapter}. */
export interface CodemirrorAdapterOptions {
  /** Extra CodeMirror extensions added after the built-in ones. */
  readonly extensions?: Extension[];
}

/** Tags transactions made by `applyChange` so the update listener does not report them as user edits. */
const External = Annotation.define<boolean>();

/** Colours come from `--sw-*` custom properties so the host's tokens (and dark mode) apply. */
function themeExtension(theme: 'light' | 'dark'): Extension {
  return EditorView.theme(
    {
      '&': { color: 'var(--sw-fg)', backgroundColor: 'var(--sw-bg)', height: '100%' },
      '.cm-content': { caretColor: 'var(--sw-fg)', fontFamily: 'var(--sw-font-mono, monospace)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--sw-fg)' },
      '&.cm-focused': { outline: '2px solid var(--sw-focus, currentColor)', outlineOffset: '-2px' },
      '.cm-gutters': { color: 'var(--sw-muted)', backgroundColor: 'var(--sw-bg)', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'var(--sw-active-line, transparent)' },
      '.cm-selectionBackground': { backgroundColor: 'var(--sw-selection, Highlight)' },
    },
    { dark: theme === 'dark' },
  );
}

function toCompletion(c: CodeCompletion): Completion {
  const out: { -readonly [K in keyof Completion]: Completion[K] } = { label: c.label, apply: c.apply };
  if (c.detail !== undefined) out.detail = c.detail;
  if (c.info !== undefined) out.info = c.info;
  if (c.section !== undefined) out.section = { name: c.section.name, rank: c.section.rank };
  if (c.boost !== undefined) out.boost = c.boost;
  return out;
}

/**
 * Builds a CodeEditorAdapter backed by CodeMirror 6. CodeMirror's own history is never installed:
 * Mod-z and Mod-Shift-z / Mod-y are routed to the host's `onUndo` / `onRedo` so one undo history exists.
 */
export function codemirrorAdapter(opts: CodemirrorAdapterOptions = {}): CodeEditorAdapter {
  return {
    mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance {
      const readOnlyCompartment = new Compartment();
      const themeCompartment = new Compartment();
      let destroyed = false;

      const readOnlyExtension = (readOnly: boolean): Extension => [
        EditorState.readOnly.of(readOnly),
        // `readOnly` only stops CodeMirror's own input handling; also refuse programmatic user edits.
        EditorState.transactionFilter.of((tr) => (tr.startState.readOnly && tr.docChanged && !tr.annotation(External) ? [] : tr)),
      ];

      const completionSource = init.complete
        ? async (context: CompletionContext): Promise<CompletionResult | null> => {
            const result = await init.complete?.(context.state.doc.toString(), context.pos, context.explicit);
            if (!result) return null;
            return { from: result.from, options: result.options.map(toCompletion), validFor: /^[\w.\-/]*$/ };
          }
        : undefined;

      const hover = init.hover;
      const hoverExtension = hover
        ? hoverTooltip((view, pos): Tooltip | null => {
            const info = hover(view.state.doc.toString(), pos);
            if (!info) return null;
            return {
              pos: info.from,
              end: info.to,
              above: true,
              create() {
                const doc = view.dom.ownerDocument;
                const dom = doc.createElement('div');
                dom.className = 'sw-hover';
                const title = doc.createElement('div');
                title.className = 'sw-hover-title';
                title.textContent = info.title;
                dom.appendChild(title);
                if (info.description) {
                  const description = doc.createElement('div');
                  description.className = 'sw-hover-description';
                  description.textContent = info.description;
                  dom.appendChild(description);
                }
                return { dom };
              },
            };
          })
        : [];

      const state = EditorState.create({
        doc: init.text,
        extensions: [
          Prec.high(
            keymap.of([
              { key: 'Mod-z', run: () => (init.onUndo(), true), preventDefault: true },
              { key: 'Mod-Shift-z', run: () => (init.onRedo(), true), preventDefault: true },
              { key: 'Mod-y', run: () => (init.onRedo(), true), preventDefault: true },
            ]),
          ),
          keymap.of(defaultKeymap),
          lineNumbers(),
          drawSelection(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          yaml(),
          EditorView.contentAttributes.of({ 'aria-label': init.ariaLabel }),
          readOnlyCompartment.of(readOnlyExtension(init.readOnly)),
          themeCompartment.of(themeExtension(init.theme)),
          autocompletion(completionSource ? { override: [completionSource] } : { override: [] }),
          hoverExtension,
          EditorView.updateListener.of((update) => {
            if (update.docChanged && update.transactions.some((tr) => tr.docChanged && !tr.annotation(External))) {
              init.onChange(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const { from, to } = update.state.selection.main;
              init.onSelectionChange?.({ from, to });
            }
          }),
          ...(opts.extensions ?? []),
        ],
      });
      const view = new EditorView({ state, parent: el });

      return {
        getText: () => view.state.doc.toString(),
        applyChange(change) {
          view.dispatch({
            changes: { from: change.from, to: change.to, insert: change.insert },
            annotations: External.of(true),
          });
        },
        setDiagnostics(d: readonly CodeDiagnostic[]) {
          const length = view.state.doc.length;
          const mapped: Diagnostic[] = d.map((x) => {
            const from = Math.min(Math.max(x.from, 0), length);
            return { from, to: Math.min(Math.max(x.to, from), length), severity: x.severity, message: x.message };
          });
          view.dispatch(setDiagnostics(view.state, mapped));
        },
        reveal(range, revealOpts) {
          const length = view.state.doc.length;
          const from = Math.min(Math.max(range.from, 0), length);
          const to = Math.min(Math.max(range.to, from), length);
          const target = EditorSelection.range(from, to);
          view.dispatch({
            ...(revealOpts?.select ? { selection: target } : {}),
            effects: EditorView.scrollIntoView(target, { y: 'center' }),
          });
        },
        getSelection() {
          const { from, to } = view.state.selection.main;
          return { from, to };
        },
        setReadOnly(readOnly) {
          view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtension(readOnly)) });
        },
        setTheme(theme) {
          view.dispatch({ effects: themeCompartment.reconfigure(themeExtension(theme)) });
        },
        focus: () => view.focus(),
        destroy() {
          if (destroyed) return;
          destroyed = true;
          view.destroy();
        },
      };
    },
  };
}
