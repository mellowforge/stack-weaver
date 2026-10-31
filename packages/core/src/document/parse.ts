import { LineCounter, parseAllDocuments, visit } from 'yaml';
import type { Document } from 'yaml';
import { detectEol } from './eol.js';
import { makeParsed } from './internal.js';
import type { ParsedText, YamlProblem } from './types.js';

/**
 * Problems for aliases with no anchor before them. `yaml` reports these only when the document is
 * converted to JS (it throws), so they are found here to keep `ok` honest.
 */
function danglingAliases(doc: Document.Parsed, lineCounter: LineCounter): YamlProblem[] {
  const out: YamlProblem[] = [];
  visit(doc, {
    Alias(_, a) {
      if (a.resolve(doc) !== undefined || !a.range) return;
      const [from, to] = a.range;
      const { line, col } = lineCounter.linePos(from);
      const message = `Unresolved alias “*${a.source}” (no anchor “&${a.source}” before it)`;
      out.push({ message, from, to, line, col });
    },
  });
  return out;
}

/**
 * Parses YAML text into documents, keeping source tokens so that edits can splice source ranges.
 * The returned `text` is the input verbatim. An alias with no matching anchor before it is an
 * error (so `ok` is false), reported at the alias range. Parser warnings, such as an unresolved
 * tag, go to `warnings` and do not affect `ok`.
 *
 * @param text - The YAML source, possibly containing several documents.
 * @returns The parsed text: its document count, errors and warnings with 1-based line/column,
 *   and the detected line ending.
 */
export function parseText(text: string): ParsedText {
  const lineCounter = new LineCounter();
  const result = parseAllDocuments(text, {
    keepSourceTokens: true,
    lineCounter,
    prettyErrors: false,
  });
  const docs = Array.isArray(result) ? result : [result];

  const toProblem = (e: { message: string; pos: [number, number] }): YamlProblem => {
    const [from, to] = e.pos;
    const { line, col } = lineCounter.linePos(from);
    return { message: e.message, from, to, line, col };
  };
  const errors: YamlProblem[] = [];
  const warnings: YamlProblem[] = [];
  for (const doc of docs) {
    errors.push(...doc.errors.map(toProblem), ...danglingAliases(doc, lineCounter));
    warnings.push(...doc.warnings.map(toProblem));
  }

  return makeParsed({ text, ok: errors.length === 0, errors, warnings, eol: detectEol(text) }, docs, lineCounter);
}
