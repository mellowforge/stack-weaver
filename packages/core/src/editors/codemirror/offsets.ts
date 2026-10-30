import type { EditorState, Text } from '@codemirror/state';

/*
 * The adapter's contract speaks in offsets of the text it hands out (UTF-16 indexes, `\r\n` is two
 * characters). CodeMirror counts every line break as one position, whatever the configured
 * `EditorState.lineSeparator`. The adapter always sets the separator to the text's own line ending,
 * so a lone `\r` or `\n` that is not the separator stays an ordinary character (one position on
 * both sides), and the only difference is one extra character per separator before the offset.
 */

/** Extra characters a line break has in the text beyond CodeMirror's one position. */
const extraOf = (lineBreak: string): number => lineBreak.length - 1;

/**
 * The text offset of CodeMirror position `pos`.
 * @internal
 */
export function toText(doc: Text, lineBreak: string, pos: number): number {
  const k = extraOf(lineBreak);
  const p = Math.min(Math.max(pos, 0), doc.length);
  return k === 0 ? p : p + (doc.lineAt(p).number - 1) * k;
}

/**
 * The CodeMirror position of text offset `offset`, clamped to the document. An offset inside a
 * line break (between `\r` and `\n`) maps to the end of that line.
 * @internal
 */
export function toCm(doc: Text, lineBreak: string, offset: number): number {
  const k = extraOf(lineBreak);
  if (k === 0) return Math.min(Math.max(offset, 0), doc.length);
  if (offset <= 0) return 0;
  // The last line whose start, as a text offset, is at or before `offset`.
  let lo = 1;
  let hi = doc.lines;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (doc.line(mid).from + (mid - 1) * k <= offset) lo = mid;
    else hi = mid - 1;
  }
  const line = doc.line(lo);
  return line.from + Math.min(offset - (line.from + (lo - 1) * k), line.length);
}

/** {@link toText} for a state. @internal */
export const stateToText = (s: EditorState, pos: number): number => toText(s.doc, s.lineBreak, pos);

/** {@link toCm} for a state. @internal */
export const stateToCm = (s: EditorState, offset: number): number => toCm(s.doc, s.lineBreak, offset);
