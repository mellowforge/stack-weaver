import { diffText } from './diff.js';
import { applyEdit } from './edit.js';
import type { EditOp, EditResult } from './edit.js';
import { parseText } from './parse.js';
import type { ParsedText, TextChange } from './types.js';

/** Who caused a change: the visual editor, the code editor, the public API, or undo/redo. */
export type ChangeOrigin = 'visual' | 'code' | 'api' | 'history';

/** Emitted to subscribers after every text change. */
export interface StoreEvent {
  /** The new full text. */
  text: string;
  /** The single splice from the previous text to `text`. */
  change: TextChange;
  /** What caused the change. */
  origin: ChangeOrigin;
  /** The parse of `text`. */
  parsed: ParsedText;
}

/** Options for {@link DocumentStore}. */
export interface StoreOptions {
  /** Clock used for grouping changes. Defaults to `Date.now`. */
  now?: () => number;
  /** Max gap in ms between consecutive `'code'` changes, or grouped `'visual'` edits, that still merge into one undo step. Default 500. */
  groupMs?: number;
  /** Max number of undo steps kept. Default 200. */
  historyLimit?: number;
}

interface Entry {
  /** Text before the entry's first change. */
  before: string;
  /** Text after the entry's last change. */
  after: string;
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
    if (r.ok && r.text !== this.#text) this.#commit(r.text, r.change, 'visual', opts?.group);
    return r;
  }

  /** Reverts the latest undo step. Returns false when there is nothing to undo. */
  undo(): boolean {
    const entry = this.#undo.pop();
    if (!entry) return false;
    this.#redo.push(entry);
    this.#apply(entry.before);
    return true;
  }

  /** Re-applies the latest undone step. Returns false when there is nothing to redo. */
  redo(): boolean {
    const entry = this.#redo.pop();
    if (!entry) return false;
    this.#undo.push(entry);
    this.#apply(entry.after);
    return true;
  }

  /**
   * Subscribes to changes; returns an unsubscribe function. Listeners run in subscription order; a
   * listener that throws is logged (`console.error`) and the rest still run.
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
  ): void {
    const now = this.#now();
    const top = this.#undo[this.#undo.length - 1];
    const close = top !== undefined && this.#lastOrigin === origin && now - this.#lastTime <= this.#groupMs;
    const merge =
      close && (origin === 'code' || (origin === 'visual' && group !== undefined && group === this.#lastGroup));
    if (merge) {
      top.after = text;
    } else {
      this.#undo.push({ before: this.#text, after: text });
      if (this.#undo.length > this.#limit) this.#undo.shift();
    }
    this.#redo = [];
    this.#lastOrigin = origin;
    this.#lastGroup = group;
    this.#lastTime = now;
    this.#set(text, change, origin);
  }

  #apply(text: string): void {
    const change = diffText(this.#text, text);
    this.#lastOrigin = 'history';
    this.#lastGroup = undefined;
    this.#set(text, change, 'history');
  }

  #set(text: string, change: TextChange, origin: ChangeOrigin): void {
    this.#text = text;
    this.#parsed = parseText(text);
    if (this.#parsed.ok) this.#lastGood = this.#parsed;
    const event: StoreEvent = { text, change, origin, parsed: this.#parsed };
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
