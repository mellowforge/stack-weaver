import type { YamlPath } from '../document/types.js';

/** What every {@link CursorContext} carries. */
interface CursorBase {
  /** Zero-based index of the YAML document the cursor is in (counts `---` markers). */
  readonly doc: number;
  /** The map, or the sequence item, that the cursor adds to. */
  readonly path: YamlPath;
  /** The partial word before the cursor (may be empty). */
  readonly prefix: string;
  /** UTF-16 offset where `prefix` starts. */
  readonly from: number;
  /** Column that new child keys of `path` start at. */
  readonly indent: number;
}

/** The cursor is typing a key. */
export interface KeyCursor extends CursorBase {
  readonly position: 'key';
}

/** The cursor is typing the value after `key:`. */
export interface ValueCursor extends CursorBase {
  readonly position: 'value';
  /** The key whose value is being typed. */
  readonly key?: string;
}

/** Where the cursor is in the text, as far as completion needs to know. Discriminated by `position`. */
export type CursorContext = KeyCursor | ValueCursor;

const KEY_LINE = /^(\s*)((?:-\s+)*)([\w.\-/]*)$/;
const VALUE_LINE = /^(\s*)((?:-\s+)*)([^\s:#'"][^:#]*?):\s+([^\s#]*)$/;
const DOC_MARKER = /^---(\s|$)/;
const DASHES = /^((?:-(?:\s+|$))*)/;
const BLOCK_SCALAR_END = /(?:^|\s)[|>][-+\d]*\s*(?:#.*)?$/;
const BARE_KEY = /^(?:"([^"]*)"|'([^']*)'|([^\s#'"][^:#]*?))\s*:\s*(?:#.*)?$/;

/** One non-blank, non-comment source line, split into its structural parts. */
interface Line {
  readonly index: number;
  /** Column of the first non-space character. */
  readonly indent: number;
  /** Number of `- ` item markers at the start of the content. */
  readonly dashes: number;
  /** Column where the content after the markers starts. */
  readonly col: number;
  /** The content after the markers. */
  readonly rest: string;
}

function isSkippable(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

function parseLine(text: string, index: number): Line {
  const indent = /^ */.exec(text)![0].length;
  const body = text.slice(indent);
  const markers = DASHES.exec(body)![1]!;
  return { index, indent, dashes: markers.match(/-/g)?.length ?? 0, col: indent + markers.length, rest: body.slice(markers.length) };
}

/** Net count of unclosed `{` / `[` in `s`, ignoring quoted text and a trailing comment. */
function flowDepth(s: string): number {
  let depth = 0;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      if (i === 0 || /[\s,[{:]/.test(s[i - 1]!)) quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(s[i - 1]!))) {
      break;
    } else if (ch === '{' || ch === '[') {
      depth++;
    } else if (ch === '}' || ch === ']') {
      depth--;
    }
  }
  return depth;
}

/** Document index of the cursor line and the first line index that belongs to that document. */
function documentOf(lines: readonly string[], cursorLine: number): { doc: number; start: number } {
  let doc = 0;
  let start = 0;
  let seenContent = false;
  for (let i = 0; i < cursorLine; i++) {
    const l = lines[i]!;
    if (DOC_MARKER.test(l)) {
      if (seenContent) doc++;
      start = i + 1;
      seenContent = false;
    } else if (!isSkippable(l)) {
      seenContent = true;
    }
  }
  // A marker that came before any content does not separate documents.
  return { doc, start };
}

/**
 * Counts the `- ` lines at `dashCol` above `from`, up to the parent that holds the sequence.
 * Returns the index of the item that starts at `from`, and the line index where the parent was
 * found (`start - 1` when the sequence reaches the document start).
 */
function sequenceIndex(lines: readonly string[], from: number, dashCol: number, start: number): { index: number; parent: number } {
  let index = 0;
  for (let i = from - 1; i >= start; i--) {
    if (isSkippable(lines[i]!)) continue;
    const l = parseLine(lines[i]!, i);
    if (l.indent > dashCol) continue;
    if (l.indent === dashCol && l.dashes > 0) {
      index++;
      continue;
    }
    return { index, parent: i };
  }
  return { index, parent: start - 1 };
}

/** The key of a `key:` line whose value is empty (so its children follow), or `undefined`. */
function parentKey(rest: string): string | undefined {
  const m = BARE_KEY.exec(rest.trimEnd());
  return m ? (m[1] ?? m[2] ?? m[3]!.trim()) : undefined;
}

/**
 * Walks the lines above `lineIndex` and builds the path of the map that a key at column `target`
 * (with `dashes` item markers before it, starting at `dashCol`) belongs to. `undefined` when the
 * cursor is inside a block scalar or a flow collection.
 */
function ancestorPath(lines: readonly string[], lineIndex: number, start: number, keyCol: number, dashCol: number, dashes: number): YamlPath | undefined {
  const segments: (string | number)[] = []; // leaf first
  let target = keyCol;
  let allowEqual = false;
  let i = lineIndex - 1;

  const openItems = (from: number, col: number, count: number): void => {
    const { index, parent } = sequenceIndex(lines, from, col, start);
    for (let n = 1; n < count; n++) segments.push(0);
    segments.push(index);
    target = col;
    allowEqual = true;
    i = parent;
  };

  if (dashes > 0) openItems(lineIndex, dashCol, dashes);

  while (i >= start) {
    const text = lines[i]!;
    if (isSkippable(text)) {
      i--;
      continue;
    }
    const l = parseLine(text, i);
    const isParent = l.col < target || (allowEqual && l.col === target && l.dashes === 0);
    if (isParent) {
      if (flowDepth(l.rest) > 0 || BLOCK_SCALAR_END.test(l.rest)) return undefined;
      const key = parentKey(l.rest);
      if (key === undefined) return undefined;
      segments.push(key);
      target = l.col;
      allowEqual = false;
    }
    if (l.dashes > 0 && l.col === target) {
      // This line starts a sequence item whose map is the one being built.
      openItems(i, l.indent, l.dashes);
      continue;
    }
    i--;
  }
  return segments.reverse();
}

/**
 * Works out what the cursor is doing from the indentation of the text above it. The text may not
 * parse while the user is typing, so this never uses the parse tree. Line breaks may be `\n` or
 * `\r\n`.
 *
 * @param text - The whole document text.
 * @param offset - UTF-16 cursor offset into `text`.
 * @returns The context, or `undefined` when no completion applies: a comment line, the inside of
 *   a block scalar or a flow collection, or text that is neither a key nor a `key: value` line.
 */
export function cursorContext(text: string, offset: number): CursorContext | undefined {
  const lines = text.slice(0, offset).split(/\r\n|\n|\r/);
  const cursorLine = lines.length - 1;
  const line = lines[cursorLine]!;
  if (DOC_MARKER.test(line) || line.trimStart().startsWith('#')) return undefined;

  const value = VALUE_LINE.exec(line);
  const key = value ? undefined : KEY_LINE.exec(line);
  const m = value ?? key;
  if (!m) return undefined;
  const lead = m[1]!;
  const markers = m[2]!;
  const prefix = (value ? m[4] : m[3])!;
  if (flowDepth(line) > 0) return undefined;

  const dashes = markers.match(/-/g)?.length ?? 0;
  const keyCol = lead.length + markers.length;
  const { doc, start } = documentOf(lines, cursorLine);
  const path = ancestorPath(lines, cursorLine, start, keyCol, lead.length, dashes);
  if (!path) return undefined;

  const base = { doc, path, prefix, from: offset - prefix.length, indent: keyCol };
  return value ? { ...base, position: 'value', key: m[3]!.trim() } : { ...base, position: 'key' };
}
