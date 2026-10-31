import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting } from '@codemirror/language';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Text, type Extension } from '@codemirror/state';
import { drawSelection, EditorView, highlightActiveLine, hoverTooltip, keymap, lineNumbers } from '@codemirror/view';
import { swHighlightStyle } from './highlight.js';
import { hoverSource } from './hover.js';
import { stateToCm, stateToText, toCm } from './offsets.js';
import type { CodeCompletion } from '../../assist/complete.js';
import { detectEol } from '../../document/eol.js';
import type { TextChange } from '../../document/types.js';
import type { ResolvedTheme } from '../../editor/theme.js';
import type { CodeDiagnostic, SyncCodeEditorAdapter, CodeEditorInit, CodeEditorInstance } from '../adapter.js';

export type { SyncCodeEditorAdapter } from '../adapter.js';

/** Options for {@link codemirrorAdapter}. */
export interface CodemirrorAdapterOptions {
  /** Extra CodeMirror extensions added after the built-in ones. */
  readonly extensions?: Extension[];
}

/** Tags transactions made by `applyChange` so the update listener does not report them as user edits. */
const External = Annotation.define<boolean>();

/** `text` as a CodeMirror document whose only line separator is `eol`. */
const docText = (text: string, eol: string): Text => Text.of(text.split(eol));

/**
 * Where text offset `pos` goes through the splice `c` (`length` is the inserted length), as
 * CodeMirror maps positions: inside the replaced range, `assoc < 0` gives its start and `assoc >= 0`
 * its end; at an insertion point, `assoc < 0` stays before the inserted text.
 */
function mapOffset(pos: number, c: { from: number; to: number; length: number }, assoc: number): number {
  if (pos < c.from) return pos;
  if (pos > c.to || (pos === c.to && c.to > c.from)) return pos + c.length - (c.to - c.from);
  if (pos === c.from && c.to > c.from) return c.from;
  return assoc < 0 ? c.from : c.from + c.length;
}

/** Colours come from `--sw-*` custom properties so the host's tokens (and dark mode) apply. */
function themeExtension(theme: ResolvedTheme): Extension {
  return EditorView.theme(
    {
      '&': { color: 'var(--sw-fg)', backgroundColor: 'var(--sw-bg)', height: '100%' },
      '.cm-content': { caretColor: 'var(--sw-fg)', fontFamily: 'var(--sw-mono, monospace)' },
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
 *
 * Line endings are kept: the line ending of the text (its first line break, as `parseText`
 * detects it) is CodeMirror's only `EditorState.lineSeparator`, so the text round-trips byte for
 * byte, and every offset is translated between the text (where `\r\n` is two characters) and
 * CodeMirror (where a line break is one position). When an external change gives the text another
 * line ending (an empty document filled with CRLF text, say), the document is rebuilt under the new
 * separator; the selection is mapped through the change. Pasted or dropped text takes the
 * document's line ending.
 */
export function codemirrorAdapter(opts: CodemirrorAdapterOptions = {}): SyncCodeEditorAdapter {
  return {
    mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance {
      const readOnlyCompartment = new Compartment();
      const themeCompartment = new Compartment();
      const separatorCompartment = new Compartment();
      let destroyed = false;

      const readOnlyExtension = (readOnly: boolean): Extension => [
        EditorState.readOnly.of(readOnly),
        // `readOnly` only stops CodeMirror's own input handling; also refuse programmatic user edits.
        EditorState.transactionFilter.of((tr) => (tr.startState.readOnly && tr.docChanged && !tr.annotation(External) ? [] : tr)),
      ];

      const completionSource = init.complete
        ? async (context: CompletionContext): Promise<CompletionResult | null> => {
            const s = context.state;
            const result = await init.complete?.(s.sliceDoc(), stateToText(s, context.pos), context.explicit);
            if (!result) return null;
            return { from: stateToCm(s, result.from), options: result.options.map(toCompletion), validFor: /^[\w.\-/]*$/ };
          }
        : undefined;

      const hoverExtension = init.hover ? hoverTooltip(hoverSource(init.hover)) : [];

      const state = EditorState.create({
        doc: docText(init.text, detectEol(init.text)),
        extensions: [
          // The text's own line ending is the only separator, so `sliceDoc()` gives the text back byte for byte.
          separatorCompartment.of(EditorState.lineSeparator.of(detectEol(init.text))),
          // Pasted or dropped text uses the document's line ending, so it is not kept as characters inside a line.
          EditorView.clipboardInputFilter.of((text, s) => text.replace(/\r\n?|\n/g, s.lineBreak)),
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
          syntaxHighlighting(swHighlightStyle),
          yaml(),
          EditorView.contentAttributes.of({ 'aria-label': init.ariaLabel }),
          readOnlyCompartment.of(readOnlyExtension(init.readOnly)),
          themeCompartment.of(themeExtension(init.theme)),
          autocompletion(completionSource ? { override: [completionSource] } : { override: [] }),
          hoverExtension,
          EditorView.updateListener.of((update) => {
            const s = update.state;
            if (update.docChanged && update.transactions.some((tr) => tr.docChanged && !tr.annotation(External))) {
              init.onChange(s.sliceDoc());
            }
            if (update.selectionSet && update.transactions.some((tr) => tr.selection && !tr.annotation(External))) {
              const { from, to } = s.selection.main;
              init.onSelectionChange?.({ from: stateToText(s, from), to: stateToText(s, to) });
            }
          }),
          ...(opts.extensions ?? []),
        ],
      });
      const view = new EditorView({ state, parent: el });

      /**
       * Applies a splice given in text offsets. When the result's line ending differs from the
       * separator (an empty document receiving CRLF text, say), the document is rebuilt under the
       * new separator in one transaction; the selection is mapped through the splice in text offsets.
       */
      function applyChange(change: TextChange): void {
        const s = view.state;
        const old = s.sliceDoc();
        let from = Math.min(Math.max(change.from, 0), old.length);
        let to = Math.min(Math.max(change.to, from), old.length);
        let insert = change.insert;
        const next = old.slice(0, from) + insert + old.slice(to);
        const eol = detectEol(next);
        if (next.includes('\n') && eol !== s.lineBreak) {
          const doc = docText(next, eol);
          const c = { from, to, length: insert.length };
          const { anchor, head } = s.selection.main;
          const [a, b] = [stateToText(s, anchor), stateToText(s, head)];
          const empty = a === b;
          const mapA = mapOffset(a, c, empty ? -1 : a <= b ? 1 : -1);
          const mapB = empty ? mapA : mapOffset(b, c, a <= b ? -1 : 1);
          view.dispatch({
            changes: { from: 0, to: s.doc.length, insert: doc },
            selection: EditorSelection.range(toCm(doc, eol, mapA), toCm(doc, eol, mapB)),
            effects: separatorCompartment.reconfigure(EditorState.lineSeparator.of(eol)),
            annotations: External.of(true),
          });
          return;
        }
        if (s.lineBreak === '\r\n') {
          // Never cut a `\r\n` in two, nor make one across the edge of the splice: widen to whole line breaks.
          const end = (): number => from + insert.length;
          const at = (t: string, i: number): string => t.charAt(i);
          if ((at(old, from - 1) === '\r' && at(old, from) === '\n') || (at(next, from - 1) === '\r' && at(next, from) === '\n')) {
            from--;
            insert = old.charAt(from) + insert;
          }
          if ((at(old, to - 1) === '\r' && at(old, to) === '\n') || (at(next, end() - 1) === '\r' && at(next, end()) === '\n')) {
            insert += old.charAt(to);
            to++;
          }
        }
        view.dispatch({
          changes: { from: stateToCm(s, from), to: stateToCm(s, to), insert: docText(insert, s.lineBreak) },
          annotations: External.of(true),
        });
      }

      return {
        getText: () => view.state.sliceDoc(),
        applyChange,
        setDiagnostics(d: readonly CodeDiagnostic[]) {
          const s = view.state;
          const mapped: Diagnostic[] = d.map((x) => {
            const from = stateToCm(s, x.from);
            // `code`, `source` and the action `id` ride along as extra properties so they can be read back;
            // CodeMirror's own `source` would render as a visible, untranslated label.
            const diagnostic: Diagnostic & { code: string; swSource: string } = {
              from,
              to: Math.max(stateToCm(s, x.to), from),
              severity: x.severity,
              message: x.message,
              swSource: x.source,
              code: x.code,
            };
            if (x.actions?.length) diagnostic.actions = x.actions.map((a) => ({ id: a.id, name: a.label, apply: () => a.apply() }));
            return diagnostic;
          });
          view.dispatch(setDiagnostics(s, mapped));
        },
        reveal(range, revealOpts) {
          const s = view.state;
          const from = stateToCm(s, range.from);
          const to = Math.max(stateToCm(s, range.to), from);
          const target = EditorSelection.range(from, to);
          view.dispatch({
            ...(revealOpts?.select ? { selection: target } : {}),
            effects: EditorView.scrollIntoView(target, { y: 'center' }),
          });
        },
        getSelection() {
          const s = view.state;
          const { from, to } = s.selection.main;
          return { from: stateToText(s, from), to: stateToText(s, to) };
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
