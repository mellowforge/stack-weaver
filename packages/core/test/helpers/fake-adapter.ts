import type {
  CodeDiagnostic,
  CodeEditorAdapter,
  CodeEditorInit,
  CodeEditorInstance,
  SyncCodeEditorAdapter,
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
  /** Whether `destroy()` ran. */
  readonly destroyed: boolean;
  /** Names of the host-driven methods called after `destroy()` (should stay empty). */
  readonly callsAfterDestroy: readonly string[];
  /** Simulates user input: sets the textarea value and fires `input`, as a user's edit would. The `input` handler rejects it while read-only. */
  type(text: string): void;
  /** Moves the caret as the user would; calls `onSelectionChange`. */
  setCaret(offset: number): void;
  /** Asks `complete` at the caret (explicit) and resolves to the option labels offered. */
  requestCompletions(): Promise<string[]>;
}

/** How the fake adapter mounts. The default is synchronous. */
export interface FakeAdapterOptions {
  /**
   * `true`: `mount` returns a promise that resolves on a later microtask (`adapter.last` is set when it resolves).
   * `'manual'`: it resolves when the test calls `release()`.
   */
  readonly async?: boolean | 'manual';
  /** `mount` rejects with this (or throws it synchronously when `async` is not set). */
  readonly reject?: unknown;
}

type FakeBase = { last?: FakeInstance; mounts: number; release(): void };
/** The fake adapter mounting synchronously (the default). */
export type SyncFakeAdapter = FakeBase & SyncCodeEditorAdapter & { mount(el: HTMLElement, init: CodeEditorInit): FakeInstance };
/** The fake adapter mounting asynchronously or rejecting. */
export type AsyncFakeAdapter = FakeBase & Omit<CodeEditorAdapter, 'mount'> & { mount(el: HTMLElement, init: CodeEditorInit): Promise<FakeInstance> };

/**
 * Creates the fake adapter; `last` is the most recently mounted instance (with an `async` mount,
 * it is set when the mount resolves), `mounts` counts `mount` calls.
 */
export function createFakeAdapter(opts?: { async?: false }): SyncFakeAdapter;
export function createFakeAdapter(opts: FakeAdapterOptions): AsyncFakeAdapter;
export function createFakeAdapter(opts: FakeAdapterOptions = {}): FakeBase & CodeEditorAdapter {
  const pending: (() => void)[] = [];
  const adapter: FakeBase & CodeEditorAdapter = {
    mounts: 0,
    /** Resolves the mounts waiting under `async: 'manual'`. */
    release() {
      for (const resolve of pending.splice(0)) resolve();
    },
    mount(el: HTMLElement, init: CodeEditorInit): FakeInstance | Promise<FakeInstance> {
      adapter.mounts++;
      if (opts.async === undefined || opts.async === false) {
        if ('reject' in opts) throw opts.reject;
        return build(el, init);
      }
      if ('reject' in opts) return Promise.reject(opts.reject);
      if (opts.async === 'manual') return new Promise((resolve) => pending.push(() => resolve(build(el, init))));
      return Promise.resolve().then(() => build(el, init));
    },
  };
  function build(el: HTMLElement, init: CodeEditorInit): FakeInstance {
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
  const callsAfterDestroy: string[] = [];
  const note = (name: string): void => {
    if (destroyed) callsAfterDestroy.push(name);
  };

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
      note('applyChange');
        text = text.slice(0, c.from) + c.insert + text.slice(c.to);
        selection = mapSelection(selection, c);
        render();
      },
      setDiagnostics(d) {
      note('setDiagnostics');
        diagnostics = d.map((x) => {
          const from = clamp(x.from);
          return { ...x, from, to: Math.min(Math.max(x.to, from), text.length) };
        });
      },
      reveal(range, opts) {
      note('reveal');
        revealed = { range, select: opts?.select === true };
        if (opts?.select) setSelection(range);
      },
      getSelection: () => selection,
      setReadOnly(v) {
      note('setReadOnly');
        readOnly = v;
        render();
      },
      setTheme(t) {
      note('setTheme');
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
      get destroyed() {
        return destroyed;
      },
      get callsAfterDestroy() {
        return callsAfterDestroy;
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
  }
  return adapter;
}
