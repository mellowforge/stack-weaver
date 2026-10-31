import { diffText } from './diff.js';
import { applyEdit } from './edit.js';
import type { EditOp, EditResult } from './edit.js';
import { parseText } from './parse.js';
import type { ParsedText, TextChange } from './types.js';

/**
 * Who caused a change: the visual editor, the code editor, the public API, or undo/redo. May grow in later
 * versions; treat an unknown value like `'api'` (a change that did not come from typing).
 */
export type ChangeOrigin = 'visual' | 'code' | 'api' | 'history';

/** Emitted to subscribers after every text change. */
export interface StoreEvent {
  /** The new full text. */
  readonly text: string;
  /** The single splice from the previous text to `text`. */
  readonly change: TextChange;
  /** What caused the change. */
  readonly origin: ChangeOrigin;
  /**
   * Present only when `origin` is `'history'`: the origin of the undo step that was undone or redone (a merged
   * step keeps its first change's origin). Never `'history'`.
   */
  readonly step?: Exclude<ChangeOrigin, 'history'>;
  /** The parse of `text`. */
  readonly parsed: ParsedText;
}

/** Options for {@link DocumentStore}. */
export interface StoreOptions {
  /** Clock used for grouping changes. Defaults to `Date.now`. */
  readonly now?: () => number;
  /** Max gap in ms between consecutive `'code'` changes, or grouped `'visual'` edits, that still merge into one undo step. Default 500. */
  readonly groupMs?: number;
  /** Max number of undo steps kept. Default 200. */
  readonly historyLimit?: number;
}

interface Entry {
  /** Text before the entry's first change. */
  before: string;
  /** Text after the entry's last change. */
  after: string;
  /** What caused the step's first change. */
  origin: Exclude<ChangeOrigin, 'history'>;
}

/**
 * Holds the YAML text, its latest and last-good parse, and one undo history
 * shared by every view. History stores text snapshots.
 */
export class DocumentStore {
  #text: string;
  #parsed: ParsedText;
  #lastGood: ParsedText | undefined;
  #undo: Entry[] = [];
  #redo: Entry[] = [];
  #listeners = new Set<(e: StoreEvent) => void>();
  #now: () => number;
  #groupMs: number;
  #limit: number;
  #lastOrigin: ChangeOrigin | null = null;
  #lastTime = 0;
  #lastGroup: string | undefined;

  /** Creates a store holding `text`, with empty history. */
  constructor(text: string, opts: StoreOptions = {}) {
    this.#text = text;
    this.#parsed = parseText(text);
    this.#lastGood = this.#parsed.ok ? this.#parsed : undefined;
    this.#now = opts.now ?? Date.now;
    this.#groupMs = opts.groupMs ?? 500;
    this.#limit = opts.historyLimit ?? 200;
  }

  /** The current text. */
  get text(): string {
    return this.#text;
  }

  /** The parse of the current text (may have errors). */
  get parsed(): ParsedText {
    return this.#parsed;
  }

  /**
   * The most recent parse that succeeded (`ok`), kept while the current text is broken;
   * `undefined` when no parse has succeeded yet.
   */
  get lastGood(): ParsedText | undefined {
    return this.#lastGood;
  }

  /** Whether {@link undo} would do anything. */
  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  /** Whether {@link redo} would do anything. */
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /**
   * Replaces the whole text. A no-op when the text is unchanged.
   * Only `'code'` changes merge: a `'code'` change within `groupMs` of the previous change, which
   * was also `'code'`, joins its undo step. `'api'` and `'visual'` changes, and the first change
   * after an undo or redo, always start a new step.
   */
  setText(text: string, origin: Exclude<ChangeOrigin, 'history'>): void {
    if (text === this.#text) return;
    this.#commit(text, diffText(this.#text, text), origin);
  }

  /**
   * Applies a structural edit to the current parse (never `lastGood`); the change is tagged
   * `'visual'`. Returns the refusal, changing nothing and emitting nothing, when the edit cannot
   * be made. Returns the ok result without emitting or recording history when the edit leaves the
   * text unchanged (for example, setting a value it already has).
   *
   * Without `opts.group` the edit is its own undo step. With a group, it joins the previous undo
   * step when that step's last change was a `'visual'` edit with the same group within `groupMs`
   * (for example, each keystroke of one field). The first change after an undo or redo never
   * merges.
   */
  edit(op: EditOp, opts?: { group?: string }): EditResult {
    const r = applyEdit(this.#parsed, op);
    if (r.ok && r.text !== this.#text) this.#commit(r.text, r.change, 'visual', opts?.group, r.parsed);
    return r;
  }

  /**
   * Applies `ops` in order, all or nothing. A single op behaves exactly like {@link edit} (same
   * `opts.group` merging). With several ops each is applied to scratch text first (an op sees the
   * result of the one before), and only if none is refused is the net change committed as one
   * `'visual'` splice: one event, one undo step that never merges, and no subscriber ever sees an
   * intermediate text. The first refusal is returned, changing nothing and emitting nothing; `opts.group`
   * is ignored for several ops. No ops, or ops that leave the text unchanged, return the ok result without
   * emitting or recording history. The ok result of several ops carries the net splice and the last op's `at`.
   */
  transact(ops: readonly EditOp[], opts?: { readonly group?: string }): EditResult {
    if (ops.length === 1) return this.edit(ops[0]!, opts);
    let last: Extract<EditResult, { ok: true }> | undefined;
    let p = this.#parsed;
    for (const op of ops) {
      const r = applyEdit(p, op);
      if (!r.ok) return r;
      last = r;
      p = r.parsed; // the next op reads the previous op's parse: no extra parse
    }
    if (!last || last.text === this.#text) {
      return { ok: true, text: this.#text, change: { from: 0, to: 0, insert: '' }, parsed: this.#parsed };
    }
    const change = diffText(this.#text, last.text);
    this.#commit(last.text, change, 'visual', undefined, last.parsed);
    return { ...last, change };
  }

  /**
   * Replaces the whole text as an `'api'` change and clears the undo and redo history; one event.
   * When `text` equals the current text only the history is cleared and no event is emitted.
   */
  reset(text: string): void {
    const change = text === this.#text ? undefined : diffText(this.#text, text);
    this.clearHistory();
    if (change) this.#set(text, change, 'api');
  }

  /** Empties the undo and redo history, leaving the text as it is. Emits no event. */
  clearHistory(): void {
    this.#undo = [];
    this.#redo = [];
    this.#lastOrigin = null;
    this.#lastGroup = undefined;
  }

  /** Reverts the latest undo step. Returns false when there is nothing to undo. */
  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push(entry);
    this.#apply(entry.before, entry.origin);
    return true;
  }

  /** Re-applies the latest undone step. Returns false when there is nothing to redo. */
  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push(entry);
    this.#apply(entry.after, entry.origin);
    return true;
  }

  /**
   * Subscribes to changes; returns an unsubscribe function. Listeners run in subscription order; a
   * listener that throws is logged (`console.error`) and the rest still run. Only text changes are
   * reported: {@link clearHistory}, and {@link reset} to the current text, change `canUndo` / `canRedo`
   * without an event.
   */
  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #commit(
    text: string,
    change: TextChange,
    origin: Exclude<ChangeOrigin, 'history'>,
    group?: string,
    parsed?: ParsedText,
  ): void {
    const now = this.#now();
    const top = this.#undo[this.#undo.length - 1];
    const close = top !== undefined && this.#lastOrigin === origin && now - this.#lastTime <= this.#groupMs;
    const merge =
      close && (origin === 'code' || (origin === 'visual' && group !== undefined && group === this.#lastGroup));
    if (merge) {
      top.after = text;
    } else {
      this.#undo.push({ before: this.#text, after: text, origin });
      if (this.#undo.length > this.#limit) this.#undo.shift();
    }
    this.#redo = [];
    this.#lastOrigin = origin;
    this.#lastGroup = group;
    this.#lastTime = now;
    this.#set(text, change, origin, parsed);
  }

  #apply(text: string, step: Exclude<ChangeOrigin, 'history'>): void {
    const change = diffText(this.#text, text);
    this.#lastOrigin = 'history';
    this.#lastGroup = undefined;
    this.#set(text, change, 'history', undefined, step);
  }

  /** Adopts `text`; `parsed`, when given, must be its parse (an edit's result), saving a second parse. */
  #set(
    text: string,
    change: TextChange,
    origin: ChangeOrigin,
    parsed: ParsedText = parseText(text),
    step?: Exclude<ChangeOrigin, 'history'>,
  ): void {
    this.#text = text;
    this.#parsed = parsed;
    if (this.#parsed.ok) this.#lastGood = this.#parsed;
    const event: StoreEvent = { text, change, origin, parsed: this.#parsed, ...(step ? { step } : {}) };
    // The text has already changed: one listener's failure must not keep the others from hearing of it.
    for (const fn of [...this.#listeners]) {
      try {
        fn(event);
      } catch (err) {
        console.error('stack-weaver: a store listener threw', err);
      }
    }
  }
}
