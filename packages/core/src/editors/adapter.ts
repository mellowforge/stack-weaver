import type { CodeCompletion } from '../assist/complete.js';
import type { HoverInfo } from '../assist/hover.js';
import type { TextChange, TextRange } from '../document/types.js';
import type { Severity } from '../validation/problems.js';

/** A problem marker shown in the code editor. */
export interface CodeDiagnostic {
  /** Start offset (UTF-16 index). */
  readonly from: number;
  /** End offset (UTF-16 index). */
  readonly to: number;
  /** How the marker is styled. */
  readonly severity: Severity;
  /** Text shown for the marker. */
  readonly message: string;
}

/** Completions for the cursor position: the options replace `[from, cursor)` when accepted. */
export interface CodeCompletionResult {
  /** Offset where the text matched against the options starts. */
  readonly from: number;
  /** The options to offer. */
  readonly options: readonly CodeCompletion[];
}

/** What an adapter needs from its host when it mounts an editor. */
export interface CodeEditorInit {
  /** Initial document text. */
  readonly text: string;
  /** Whether the user is blocked from editing. */
  readonly readOnly: boolean;
  /** Colour scheme of the editor surface. */
  readonly theme: 'light' | 'dark';
  /** Accessible name of the editing surface. */
  readonly ariaLabel: string;
  /** Called with the full text after every user edit; never called for {@link CodeEditorInstance.applyChange}. */
  onChange(text: string): void;
  /** Called when the user asks to undo (Mod-z); the adapter itself never changes the text. */
  onUndo(): void;
  /** Called when the user asks to redo (Mod-Shift-z or Mod-y); the adapter itself never changes the text. */
  onRedo(): void;
  /** Called when the selection moves or changes. */
  onSelectionChange?(range: TextRange): void;
  /** Supplies completions for `offset` in `text`; `explicit` is true when the user asked for them. */
  complete?(text: string, offset: number, explicit: boolean): CodeCompletionResult | null | Promise<CodeCompletionResult | null>;
  /** Supplies hover content for `offset` in `text`. */
  hover?(text: string, offset: number): HoverInfo | undefined;
}

/** A mounted code editor. */
export interface CodeEditorInstance {
  /** The current full text. */
  getText(): string;
  /** Applies an external splice. Selections outside the change keep their place; `onChange` is not called. */
  applyChange(change: TextChange): void;
  /** Replaces all diagnostics. */
  setDiagnostics(d: readonly CodeDiagnostic[]): void;
  /** Scrolls `range` into view and, with `select`, selects it. */
  reveal(range: TextRange, opts?: { select?: boolean }): void;
  /** The main selection. */
  getSelection(): TextRange;
  /** Blocks or allows user edits. */
  setReadOnly(readOnly: boolean): void;
  /** Switches the colour scheme. */
  setTheme(theme: 'light' | 'dark'): void;
  /** Moves keyboard focus into the editor. */
  focus(): void;
  /** Removes the editor from the DOM and releases it; the instance is unusable afterwards. */
  destroy(): void;
}

/** Creates code editors. Implementations wrap a concrete editor library. */
export interface CodeEditorAdapter {
  /** Mounts an editor inside `el`. */
  mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance;
}
