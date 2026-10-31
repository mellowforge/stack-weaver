import type { CodeCompletion } from '../assist/complete.js';
import type { HoverInfo } from '../assist/hover.js';
import type { TextChange, TextRange } from '../document/types.js';
import type { ResolvedTheme } from '../editor/theme.js';
import type { ProblemCode, ProblemSource, Severity } from '../validation/problems.js';

/** A problem marker shown in the code editor. */
export interface CodeDiagnostic {
  /** Start offset (UTF-16 index). */
  readonly from: number;
  /** End offset (UTF-16 index). */
  readonly to: number;
  /** How the marker is styled. */
  readonly severity: Severity;
  /** Text shown for the marker. Plain text, never markup. */
  readonly message: string;
  /** Machine-readable code of the problem (stable; see {@link ProblemCode}). */
  readonly code: ProblemCode;
  /** Which check found the problem. */
  readonly source: ProblemSource;
  /** Quick fixes offered next to the marker; each `apply` changes the document through the host. */
  readonly actions?: readonly CodeDiagnosticAction[];
}

/** One quick fix of a {@link CodeDiagnostic}. */
export interface CodeDiagnosticAction {
  /** Stable id of the fix (`QuickFix.id`). */
  readonly id: string;
  /** Plain-text label of the action. */
  readonly label: string;
  /** Runs the fix. */
  apply(): void;
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
  readonly theme: ResolvedTheme;
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
  /** Supplies hover content for `offset` in `text`; may answer asynchronously. A rejection shows no tooltip. */
  hover?(text: string, offset: number): HoverInfo | undefined | Promise<HoverInfo | undefined>;
}

/**
 * A mounted code editor.
 *
 * The text is kept byte for byte: line endings are never normalized, so a CRLF document stays
 * CRLF in `getText()` and in `onChange`. Every offset in and out (changes, diagnostics, ranges,
 * selections, completion and hover offsets) is an offset into that text: a UTF-16 index where
 * `\r\n` counts as two characters. An editor library that counts a line break as one position
 * must translate (the CodeMirror adapter does).
 */
export interface CodeEditorInstance {
  /** The current full text, byte for byte. */
  getText(): string;
  /**
   * Applies an external splice, also while read-only. A caret outside the change keeps its place;
   * one inside a replaced range moves to its start. `onChange` and `onSelectionChange` are not called.
   */
  applyChange(change: TextChange): void;
  /** Replaces all diagnostics. */
  setDiagnostics(d: readonly CodeDiagnostic[]): void;
  /** Scrolls `range` into view and, with `select`, selects it. */
  reveal(range: TextRange, opts?: { select?: boolean }): void;
  /** The main selection, in text offsets; a collapsed range (`from === to`) is the cursor. */
  getSelection(): TextRange;
  /** Blocks or allows user edits. */
  setReadOnly(readOnly: boolean): void;
  /** Switches the colour scheme. */
  setTheme(theme: ResolvedTheme): void;
  /** Moves keyboard focus into the editor. */
  focus(): void;
  /** Removes the editor from the DOM and releases it; the instance is unusable afterwards. */
  destroy(): void;
}

/** Creates code editors. Implementations wrap a concrete editor library. */
export interface CodeEditorAdapter {
  /**
   * Mounts an editor inside `el`; may answer asynchronously. If it throws or the promise rejects,
   * the editor shows `codeEditorFailed` in the code pane instead and `ready` rejects. If the editor is
   * destroyed while a mount is pending, the host calls `destroy()` on the instance as soon as it arrives.
   */
  mount(el: HTMLElement, init: CodeEditorInit): CodeEditorInstance | Promise<CodeEditorInstance>;
}
