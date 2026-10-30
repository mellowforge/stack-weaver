import { isMap, isNode, isScalar } from 'yaml';
import { toData } from '../document/data.js';
import { getNode, getPairKey, toLineCol } from '../document/paths.js';
import type { ParsedText, YamlPath, YamlProblem } from '../document/types.js';
import type { FormatDefinition, SchemaError } from '../formats/types.js';
import { defaultMessages, messageFor } from './messages.js';
import type { Messages } from './messages.js';
import { SEVERITY_RANK } from './problems.js';
import type { Problem, Severity } from './problems.js';

const WRAPPERS = new Set(['anyOf', 'oneOf']);

/**
 * Validates parsed text against a format and maps every problem to a source range.
 *
 * Parse errors are returned as `yaml.syntax` and schema validation is skipped while the text does
 * not parse. Otherwise each document is validated against the schema its format loads for it
 * (merge keys expanded, see `toData`). Documents of an unknown kind give one `kind.unknown` info.
 * Problems are ordered by start offset, then severity.
 *
 * @param p - The parsed text.
 * @param format - The format whose schemas to validate with.
 * @returns The problems, sorted.
 */
export async function validateText(p: ParsedText, format: FormatDefinition): Promise<Problem[]> {
  const out: Problem[] = [];
  for (const w of p.warnings) out.push(yamlProblem(p, w, 'warning', 'yaml.warning'));

  if (!p.ok) {
    for (const e of p.errors) out.push(yamlProblem(p, e, 'error', 'yaml.syntax'));
    return sortProblems(out);
  }

  for (let doc = 0; doc < p.docs.length; doc++) {
    const d = p.docs[doc]!;
    if (d.contents === null) continue; // empty or comment-only document
    const bundle = await format.loadSchema(p, doc);
    if (!bundle) {
      out.push(unknownKind(p, doc));
      continue;
    }
    out.push(...schemaErrorsToProblems(p, doc, bundle.validate(toData(d))));
  }
  return sortProblems(out);
}

/**
 * Turns schema errors for one document into problems with source ranges.
 *
 * Errors are collapsed first: `anyOf`/`oneOf` wrapper errors are dropped when a branch error
 * exists, branch type errors at one path merge into a single "Must be a A or B", and identical
 * messages at one path are reported once. An `instancePath` with no node of its own (for example
 * a value that came from a merge key) maps to its nearest existing ancestor, then to the document
 * root; no error is dropped.
 *
 * @param p - The parsed text.
 * @param doc - Index of the document the errors belong to.
 * @param errors - Validator errors for that document.
 * @param messages - Message table, replaceable for translation.
 * @returns The problems, in the order of the (collapsed) errors.
 */
export function schemaErrorsToProblems(
  p: ParsedText,
  doc: number,
  errors: SchemaError[],
  messages: Messages = defaultMessages,
): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  for (const e of collapse(errors)) {
    const problem = toProblem(p, doc, e, messages);
    const key = `${problem.code}|${problem.path.join('/')}|${problem.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(problem);
  }
  return out;
}

/** Index of the document holding `offset`: the last one starting at or before it. */
function docAt(p: ParsedText, offset: number): number {
  let doc = 0;
  for (let i = 0; i < p.docs.length; i++) if (p.docs[i]!.range[0] <= offset) doc = i;
  return doc;
}

function yamlProblem(p: ParsedText, y: YamlProblem, severity: Severity, code: string): Problem {
  return {
    severity, source: 'yaml', code, message: y.message,
    doc: docAt(p, y.from), path: [], from: y.from, to: y.to, line: y.line, col: y.col,
  };
}

function sortProblems(list: Problem[]): Problem[] {
  return list
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v.from - b.v.from || SEVERITY_RANK[a.v.severity] - SEVERITY_RANK[b.v.severity] || a.i - b.i)
    .map((x) => x.v);
}

function isUnder(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Drops wrapper errors that have branch errors, then merges same-path type errors. */
function collapse(errors: SchemaError[]): SchemaError[] {
  const wrapperPaths = new Set<string>();
  for (const e of errors) if (WRAPPERS.has(e.keyword)) wrapperPaths.add(e.instancePath);

  const branches = errors.filter((e) => !WRAPPERS.has(e.keyword));
  const kept: SchemaError[] = [];
  for (const e of errors) {
    if (WRAPPERS.has(e.keyword)) {
      if (!branches.some((b) => isUnder(b.instancePath, e.instancePath))) kept.push(e); // nothing more specific
      continue;
    }
    // A branch failed on shape (e.g. "must be null" next to an object branch whose own fields
    // failed deeper): the deeper errors are the specific ones, so the shallow type error is noise.
    if (
      e.keyword === 'type' &&
      wrapperPaths.has(e.instancePath) &&
      branches.some((b) => b.instancePath.startsWith(`${e.instancePath}/`))
    ) {
      continue;
    }
    kept.push(e);
  }

  const out: SchemaError[] = [];
  const typeAt = new Map<string, { error: SchemaError; types: string[] }>();
  for (const e of kept) {
    if (e.keyword !== 'type') {
      out.push(e);
      continue;
    }
    const names = String(e.params.type).split(',');
    const hit = typeAt.get(e.instancePath);
    if (hit) {
      for (const n of names) if (!hit.types.includes(n)) hit.types.push(n);
    } else {
      const entry = { error: e, types: [...names] };
      typeAt.set(e.instancePath, entry);
      out.push(e);
    }
  }
  // Rewrite merged type errors with the joined list (in order of first appearance).
  return out.map((e) => {
    if (e.keyword !== 'type') return e;
    const entry = typeAt.get(e.instancePath);
    return entry && entry.error === e ? { ...e, params: { ...e.params, type: entry.types } } : e;
  });
}

function unescape(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Converts a JSON pointer to a path; digit segments under sequences (or unknown parents) become numbers. */
function toPath(p: ParsedText, doc: number, pointer: string): YamlPath {
  if (pointer === '') return [];
  const out: (string | number)[] = [];
  let parent: unknown = p.docs[doc]?.contents;
  for (const raw of pointer.split('/').slice(1)) {
    const seg = unescape(raw);
    const asIndex = /^\d+$/.test(seg) && !isMap(parent) ? Number(seg) : seg;
    out.push(asIndex);
    parent = getNode(p, { doc, path: out });
  }
  return out;
}

type Range = [number, number];

function rangeOf(n: unknown): Range | undefined {
  return isNode(n) && n.range ? [n.range[0], n.range[1]] : undefined;
}

function rootRange(p: ParsedText, doc: number): Range {
  const d = p.docs[doc];
  return rangeOf(d?.contents) ?? (d ? [d.range[0], d.range[1]] : [0, 0]);
}

/** Range of the nearest existing node at or above `path`, falling back to the document root. */
function nearestRange(p: ParsedText, doc: number, path: YamlPath): Range {
  for (let k = path.length; k > 0; k--) {
    const r = rangeOf(getNode(p, { doc, path: path.slice(0, k) }));
    if (r) return r;
  }
  return rootRange(p, doc);
}

function toProblem(p: ParsedText, doc: number, e: SchemaError, messages: Messages): Problem {
  const base = toPath(p, doc, e.instancePath);
  let path: YamlPath = base;
  let range: Range;

  if (e.keyword === 'required') {
    // Point at the key of the object that lacks the field; sequence items and the root have no
    // key, so use the object itself (the root: its first key rather than the whole document).
    const key = getPairKey(p, { doc, path: base });
    const node = getNode(p, { doc, path: base });
    if (key) range = rangeOf(key) ?? nearestRange(p, doc, base);
    else if (base.length === 0 && isMap(node) && isNode(node.items[0]?.key)) {
      range = rangeOf(node.items[0]!.key) ?? rootRange(p, doc);
    } else range = rangeOf(node) ?? nearestRange(p, doc, base);
  } else if (e.keyword === 'additionalProperties' || e.keyword === 'unevaluatedProperties') {
    const prop = String(e.params.additionalProperty ?? e.params.unevaluatedProperty);
    path = [...base, prop];
    const key = getPairKey(p, { doc, path });
    range = (key && rangeOf(key)) ?? nearestRange(p, doc, base);
  } else {
    range = nearestRange(p, doc, base);
  }

  const [from, to] = range;
  const { line, col } = toLineCol(p, from);
  return {
    severity: 'error', source: 'schema', code: `schema.${e.keyword}`, message: messageFor(e, messages),
    doc, path, from, to, line, col,
  };
}

function unknownKind(p: ParsedText, doc: number): Problem {
  const node = getNode(p, { doc, path: ['kind'] });
  const kind = isScalar(node) && node.value !== null ? String(node.value) : '(missing)';
  const [from, to] = rangeOf(node) ?? rootRange(p, doc);
  const { line, col } = toLineCol(p, from);
  return {
    severity: 'info', source: 'schema', code: 'kind.unknown', message: `Unknown kind “${kind}” — edit in code`,
    doc, path: isNode(node) ? ['kind'] : [], from, to, line, col,
  };
}

