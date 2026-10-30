import { LineCounter, parseAllDocuments } from 'yaml';
import type { ParsedText, YamlProblem } from './types.js';

/**
 * Parses YAML text into documents, keeping source tokens so that edits can splice source ranges.
 * The returned `text` is the input verbatim.
 *
 * @param text - The YAML source, possibly containing several documents.
 * @returns The parsed documents, errors with 1-based line/column, and the detected line ending.
 */
export function parseText(text: string): ParsedText {
  const lineCounter = new LineCounter();
  const result = parseAllDocuments(text, {
    keepSourceTokens: true,
    lineCounter,
    prettyErrors: false,
  });
  const docs = Array.isArray(result) ? result : [result];

  const errors: YamlProblem[] = [];
  for (const doc of docs) {
    for (const err of doc.errors) {
      const [from, to] = err.pos;
      const { line, col } = lineCounter.linePos(from);
      errors.push({ message: err.message, from, to, line, col });
    }
  }

  const nl = text.indexOf('\n');
  const eol = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';

  return { text, ok: errors.length === 0, docs, lineCounter, errors, eol };
}
