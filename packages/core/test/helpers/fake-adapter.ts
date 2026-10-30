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
  readonly readOnly: boolean;
  readonly theme: 'light' | 'dark';
  readonly revealed: { range: TextRange; select: boolean } | undefined;
  /** Simulates user input: replaces the whole text, as a user's edit would, and calls `onChange`. Ignored while read-only. */
  type(text: string): void;
  /** Moves the caret as the user would; calls `onSelectionChange`. */
  setCaret(offset: number): void;
  /** Simulates Mod-z. */
  pressUndo(): void;
  /** Simulates Mod-Shift-z. */
  pressRedo(): void;
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
      const mapPos = (pos: number, c: TextChange): number =>
        pos <= c.from ? pos : pos >= c.to ? pos + c.insert.length - (c.to - c.from) : c.from + c.insert.length;
      const render = (): void => {
        area.value = text;
        area.readOnly = readOnly;
        area.dataset['theme'] = theme;
      };
      render();

      const inst: FakeInstance = {
        getText: () => text,
        applyChange(c) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
          selection = { from: mapPos(selection.from, c), to: mapPos(selection.to, c) };
          render();
        },
        setDiagnostics(d) {
          diagnostics = [...d];
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
          if (readOnly || destroyed) return;
          text = next;
          selection = { from: next.length, to: next.length };
          render();
          init.onChange(text);
        },
        setCaret: (offset) => setSelection({ from: offset, to: offset }),
        pressUndo: () => init.onUndo(),
        pressRedo: () => init.onRedo(),
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
