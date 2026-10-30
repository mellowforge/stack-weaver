import type {
  CodeDiagnostic,
  CodeEditorAdapter,
  CodeEditorInit,
  CodeEditorInstance,
} from '../../src/editors/adapter.js';
import type { TextChange, TextRange } from '../../src/document/types.js';

/** A fake editor for tests: plain DOM (a `<textarea>`), with hooks that simulate the user. */
export interface FakeInstance extends CodeEditorInstance {
  /** Diagnostics last set. */
  readonly diagnostics: readonly CodeDiagnostic[];
  /** Current selection. */
  readonly selection: TextRange;
  /** The init the host passed, so tests can call `complete` and `hover` directly. */
  readonly init: CodeEditorInit;
  readonly readOnly: boolean;
  readonly theme: 'light' | 'dark';
  readonly revealed: { range: TextRange; select: boolean } | undefined;
  /** Simulates user input: sets the textarea value and fires `input`, as a user's edit would. The `input` handler rejects it while read-only. */
  type(text: string): void;
  /** Moves the caret as the user would; calls `onSelectionChange`. */
  setCaret(offset: number): void;
  /** Asks `complete` at the caret (explicit) and resolves to the option labels offered. */
  requestCompletions(): Promise<string[]>;
}

/** Creates the fake adapter; `last` is the most recently mounted instance. */
export function createFakeAdapter(): CodeEditorAdapter & { last?: FakeInstance } {
  const adapter: CodeEditorAdapter & { last?: FakeInstance } = {
    mount(el: HTMLElement, init: CodeEditorInit): FakeInstance {
      const area = el.ownerDocument.createElement('textarea');
      area.setAttribute('aria-label', init.ariaLabel);
      area.value = init.text;
      el.appendChild(area);
      let text = init.text;
      let selection: TextRange = { from: 0, to: 0 };
      let diagnostics: readonly CodeDiagnostic[] = [];
      let readOnly = init.readOnly;
      let theme = init.theme;
      let revealed: FakeInstance['revealed'];
      let destroyed = false;

      const setSelection = (next: TextRange): void => {
        if (next.from === selection.from && next.to === selection.to) return;
        selection = next;
        init.onSelectionChange?.(selection);
      };
      // As CodeMirror maps positions: inside a replaced range `assoc < 0` gives its start and
      // `assoc >= 0` its end; at an insertion point `assoc < 0` stays before the inserted text.
      const mapPos = (pos: number, c: TextChange, assoc: number): number => {
        if (pos < c.from) return pos;
        if (pos > c.to || (pos === c.to && c.to > c.from)) return pos + c.insert.length - (c.to - c.from);
        if (pos === c.from && c.to > c.from) return c.from;
        return assoc < 0 ? c.from : c.from + c.insert.length;
      };
      // A caret maps with assoc -1; a range maps its start with +1 and its end with -1, as CodeMirror does.
      const mapSelection = (s: TextRange, c: TextChange): TextRange =>
        s.from === s.to ? { from: mapPos(s.from, c, -1), to: mapPos(s.from, c, -1) } : { from: mapPos(s.from, c, 1), to: mapPos(s.to, c, -1) };
      const isMac = /Mac|iP(hone|ad|od)/.test(el.ownerDocument.defaultView?.navigator.platform ?? '');
      const clamp = (n: number): number => Math.min(Math.max(n, 0), text.length);
      /** The exact text `type` asked for: a textarea may normalize line breaks in `value`, the fake must not. */
      let typed: string | undefined;
      // The user's input path, like a real <textarea>: read-only refuses the edit (and restores the value).
      area.addEventListener('input', () => {
        const next = typed ?? area.value;
        typed = undefined;
        if (readOnly || destroyed) {
          area.value = text;
          return;
        }
        text = next;
        selection = { from: text.length, to: text.length };
        init.onChange(text);
      });
      area.addEventListener('keydown', (e) => {
        if (!(isMac ? e.metaKey : e.ctrlKey)) return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) init.onUndo();
        else if ((key === 'z' && e.shiftKey) || key === 'y') init.onRedo();
        else return;
        e.preventDefault();
      });
      const render = (): void => {
        area.value = text;
        area.readOnly = readOnly;
        area.dataset['theme'] = theme;
      };
      render();

      const inst: FakeInstance = {
        init,
        getText: () => text,
        applyChange(c) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
          selection = mapSelection(selection, c);
          render();
        },
        setDiagnostics(d) {
          diagnostics = d.map((x) => {
            const from = clamp(x.from);
            return { ...x, from, to: Math.min(Math.max(x.to, from), text.length) };
          });
        },
        reveal(range, opts) {
          revealed = { range, select: opts?.select === true };
          if (opts?.select) setSelection(range);
        },
        getSelection: () => selection,
        setReadOnly(v) {
          readOnly = v;
          render();
        },
        setTheme(t) {
          theme = t;
          render();
        },
        focus: () => area.focus(),
        destroy() {
          if (destroyed) return;
          destroyed = true;
          area.remove();
        },
        get diagnostics() {
          return diagnostics;
        },
        get selection() {
          return selection;
        },
        get readOnly() {
          return readOnly;
        },
        get theme() {
          return theme;
        },
        get revealed() {
          return revealed;
        },
        type(next) {
          typed = next;
          area.value = next;
          area.dispatchEvent(new Event('input', { bubbles: true }));
        },
        setCaret: (offset) => setSelection({ from: offset, to: offset }),
        async requestCompletions() {
          const result = await init.complete?.(text, selection.from, true);
          return result ? result.options.map((o) => o.label) : [];
        },
      };
      adapter.last = inst;
      return inst;
    },
  };
  return adapter;
}
