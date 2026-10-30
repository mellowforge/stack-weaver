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
  /** Clock used for grouping code changes. Defaults to `Date.now`. */
  now?: () => number;
  /** Max gap in ms between consecutive `'code'` changes that still merge into one undo step. Default 500. */
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
   * Consecutive `'code'` changes within `groupMs` merge into one undo step; `'api'` never merges.
   */
  setText(text: string, origin: Exclude<ChangeOrigin, 'history'>): void {
    if (text === this.#text) return;
    this.#commit(text, diffText(this.#text, text), origin);
  }

  /**
   * Applies a structural edit to the current parse (never `lastGood`) with origin `'visual'`.
   * Returns the refusal, changing nothing and emitting nothing, when the edit cannot be made.
   */
  edit(op: EditOp): EditResult {
    const r = applyEdit(this.#parsed, op);
    if (r.ok && r.text !== this.#text) this.#commit(r.text, r.change, 'visual');
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

  /** Subscribes to changes; returns an unsubscribe function. */
  subscribe(fn: (e: StoreEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  #commit(text: string, change: TextChange, origin: Exclude<ChangeOrigin, 'history'>): void {
    const now = this.#now();
    const top = this.#undo[this.#undo.length - 1];
    const merge =
      origin === 'code' && top !== undefined && this.#lastOrigin === 'code' && now - this.#lastTime <= this.#groupMs;
    if (merge) {
      top.after = text;
    } else {
      this.#undo.push({ before: this.#text, after: text });
      if (this.#undo.length > this.#limit) this.#undo.shift();
    }
    this.#redo = [];
    this.#lastOrigin = origin;
    this.#lastTime = now;
    this.#set(text, change, origin);
  }

  #apply(text: string): void {
    const change = diffText(this.#text, text);
    this.#lastOrigin = 'history';
    this.#set(text, change, 'history');
  }

  #set(text: string, change: TextChange, origin: ChangeOrigin): void {
    this.#text = text;
    this.#parsed = parseText(text);
    if (this.#parsed.ok) this.#lastGood = this.#parsed;
    const event: StoreEvent = { text, change, origin, parsed: this.#parsed };
    for (const fn of [...this.#listeners]) fn(event);
  }
}
