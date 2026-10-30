import { isMap, isNode, isScalar, isSeq } from 'yaml';
import type { Node, Scalar } from 'yaml';
import { isEmptyDocument, toData } from '../document/data.js';
import { getNode, getPairKey, toLineCol } from '../document/paths.js';
import type { ParsedText, YamlPath, YamlProblem } from '../document/types.js';
import { resolveAt } from '../engine/resolve.js';
import type { FormatDefinition, SchemaBundle, SchemaError } from '../formats/types.js';
import { defaultMessages, messageFor } from './messages.js';
import type { SchemaMessages } from './messages.js';
import { SEVERITY_RANK } from './problems.js';
import type { Problem, Severity } from './problems.js';

const WRAPPERS = new Set(['anyOf', 'oneOf']);
const UNKNOWN_KEY = new Set(['additionalProperties', 'unevaluatedProperties']);

/** Answers whether some schema at `path` declares `key` in `properties` or `patternProperties`. */
type Declares = (path: YamlPath, key: string) => boolean;

/**
 * Validates parsed text against a format and maps every problem to a source range. Never rejects
 * and never drops a problem: anything that fails along the way becomes a problem itself.
 *
 * - YAML warnings (such as an unresolved tag) are `yaml.warning` warnings, always.
 * - Parse errors (including aliases with no anchor) are `yaml.syntax` errors, and schema
 *   validation is skipped while the text does not parse.
 * - Empty documents (a bare `---`, or comments only) are skipped.
 * - In a `'mapping'` format (compose), only the first non-empty document is validated; each later
 *   non-empty one gets a `format.extraDocument` error.
 * - In a `'documents'` format with known kinds (Kubernetes), a root that is not a mapping is a
 *   `schema.type` error, and a missing or non-string `apiVersion` / `kind` is a `schema.required`
 *   error; such documents are not schema-validated. A kind the format knows only under other
 *   apiVersions is a `kind.apiVersion` error at the `apiVersion` value; a kind with no entry at
 *   all is one `kind.unknown` info.
 * - Each other document is validated against the schema its format loads for it, with merge keys
 *   expanded (see `toData`). When the data cannot be built (for example `<<: 5`), that is a
 *   `yaml.data` error at the `<<` key, or at the document root; when the schema cannot be loaded,
 *   a `schema.unavailable` error.
 *
 * Problems are ordered by start offset, then severity.
 *
 * @param p - The parsed text.
 * @param format - The format whose schemas to validate with.
 * @param opts - `messages`: entries that replace {@link defaultMessages} entries, for example
 *   translations.
 * @returns The problems, sorted.
 */
export async function validateText(
  p: ParsedText,
  format: FormatDefinition,
  opts: { messages?: Partial<SchemaMessages> } = {},
): Promise<Problem[]> {
  const messages: SchemaMessages = { ...defaultMessages };
  for (const [k, fn] of Object.entries(opts.messages ?? {})) if (fn) messages[k] = fn;

  const out: Problem[] = [];
  for (const w of p.warnings) out.push(yamlProblem(p, w, 'warning', 'yaml.warning'));

  if (!p.ok) {
    for (const e of p.errors) out.push(yamlProblem(p, e, 'error', 'yaml.syntax'));
    return sortProblems(out);
  }

  let seen = false;
  for (let doc = 0; doc < p.docs.length; doc++) {
    if (isEmptyDocument(p.docs[doc]!)) continue;
    if (format.rootModel === 'mapping' && seen) {
      const [from, to] = rootRange(p, doc);
      out.push(problem(p, doc, 'error', 'schema', 'format.extraDocument', messages, {}, [], [from, to]));
      continue;
    }
    seen = true;
    out.push(...(await validateDocument(p, doc, format, messages)));
  }
  return sortProblems(out);
}

async function validateDocument(
  p: ParsedText,
  doc: number,
  format: FormatDefinition,
  messages: SchemaMessages,
): Promise<Problem[]> {
  let data: unknown;
  try {
    data = toData(p.docs[doc]!);
  } catch (err) {
    const merge = findMergeKey(p.docs[doc]!.contents, []);
    const range = (merge && rangeOf(merge.key)) ?? rootRange(p, doc);
    return [problem(p, doc, 'error', 'yaml', 'yaml.data', messages, { cause: causeOf(err) }, merge?.path ?? [], range)];
  }

  const kinds = format.rootModel === 'documents' ? format.kinds() : [];
  if (kinds.length > 0) {
    const shape = shapeProblems(p, doc, messages);
    if (shape.length > 0) return shape;
  }

  const kindNode = getNode(p, { doc, path: ['kind'] });
  const kind = isScalar(kindNode) && typeof kindNode.value === 'string' ? kindNode.value : undefined;
  let bundle: SchemaBundle | undefined;
  let errors: SchemaError[];
  try {
    bundle = await format.loadSchema(p, doc);
    errors = bundle ? bundle.validate(data) : [];
  } catch (err) {
    const params = { kind: kind ?? format.label, cause: causeOf(err) };
    return [problem(p, doc, 'error', 'schema', 'schema.unavailable', messages, params, [], rootRange(p, doc))];
  }

  if (!bundle) {
    const known = kind === undefined ? [] : kinds.filter((k) => k.kind === kind);
    if (known.length > 0) {
      const node = getNode(p, { doc, path: ['apiVersion'] });
      const params = { apiVersion: (node as Scalar).value, kind, expected: known.map((k) => k.apiVersion) };
      return [problem(p, doc, 'error', 'schema', 'kind.apiVersion', messages, params, ['apiVersion'], rangeOf(node) ?? rootRange(p, doc))];
    }
    const params = { kind: kindNode && isScalar(kindNode) && kindNode.value !== null ? String(kindNode.value) : '(missing)' };
    const path = isNode(kindNode) ? ['kind'] : [];
    return [problem(p, doc, 'info', 'schema', 'kind.unknown', messages, params, path, rangeOf(kindNode) ?? rootRange(p, doc))];
  }
  return schemaErrorsToProblems(p, doc, errors, messages, declaredIn(bundle, data));
}

/** A `documents` format's required document shape: a mapping with string `apiVersion` and `kind`. */
function shapeProblems(p: ParsedText, doc: number, messages: SchemaMessages): Problem[] {
  const root = p.docs[doc]!.contents;
  if (!isMap(root)) {
    return [problem(p, doc, 'error', 'schema', 'document.mapping', messages, {}, [], rootRange(p, doc), 'schema.type')];
  }
  const out: Problem[] = [];
  for (const field of ['apiVersion', 'kind']) {
    const node = getNode(p, { doc, path: [field] });
    if (isScalar(node) && typeof node.value === 'string') continue;
    if (node === undefined || (isScalar(node) && node.value === null && rangeOf(node)?.[0] === rangeOf(node)?.[1])) {
      const range = node ? (rangeOf(getPairKey(p, { doc, path: [field] })) ?? rootRange(p, doc)) : firstKeyRange(p, doc);
      out.push(problem(p, doc, 'error', 'schema', 'required', messages, { missingProperty: field }, node ? [field] : [], range, 'schema.required'));
    } else {
      out.push(problem(p, doc, 'error', 'schema', 'type', messages, { type: 'string' }, [field], rangeOf(node) ?? rootRange(p, doc), 'schema.required'));
    }
  }
  return out;
}

/** The first `<<` pair in `node`, depth first, with the path of its key. */
function findMergeKey(node: unknown, path: (string | number)[]): { path: YamlPath; key: Node } | undefined {
  if (isMap(node)) {
    for (const pr of node.items) {
      const k = isScalar(pr.key) ? pr.key.value : undefined;
      if (k === '<<' && isNode(pr.key)) return { path: [...path, '<<'], key: pr.key };
      const hit = findMergeKey(pr.value, [...path, String(k)]);
      if (hit) return hit;
    }
  } else if (isSeq(node)) {
    for (let i = 0; i < node.items.length; i++) {
      const hit = findMergeKey(node.items[i], [...path, i]);
      if (hit) return hit;
    }
  }
  return undefined;
}

const causeOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Builds a {@link Declares} from the bundle: `properties` or a matching `patternProperties` entry. */
function declaredIn(bundle: SchemaBundle, data: unknown): Declares {
  return (path, key) => {
    const schema = resolveAt(bundle, path, data)?.schema;
    if (!schema) return false;
    const props = schema['properties'];
    if (typeof props === 'object' && props !== null && Object.hasOwn(props, key)) return true;
    const patterns = schema['patternProperties'];
    if (typeof patterns !== 'object' || patterns === null) return false;
    return Object.keys(patterns).some((re) => {
      try {
        return new RegExp(re, 'u').test(key);
      } catch {
        return false;
      }
    });
  };
}

/**
 * Turns schema errors for one document into problems with source ranges.
 *
 * Errors are collapsed first:
 * - `anyOf`/`oneOf` wrapper errors are dropped when a branch error exists at or under their path;
 * - the shallow-type-drop rule: a branch's `type` error at a wrapper's path is dropped when
 *   another branch has errors deeper inside (the value had the right shape for that branch, so
 *   its deeper errors are the specific ones, and "must be null" next to them is noise);
 * - an `additionalProperties`/`unevaluatedProperties` error for a key that a schema at that path
 *   declares (in `properties` or `patternProperties`) is dropped when other errors exist at or
 *   under the same object: when one field fails, `unevaluatedProperties` loses track of the
 *   valid siblings and reports them all as unknown;
 * - branch type errors at one path merge into a single "Must be an A or B";
 * - identical messages at one path are reported once.
 *
 * An `instancePath` with no node of its own (for example a value that came from a merge key) maps
 * to its nearest existing ancestor, then to the document root; no error is dropped for lacking a
 * source node.
 *
 * @param p - The parsed text.
 * @param doc - Index of the document the errors belong to.
 * @param errors - Validator errors for that document.
 * @param messages - Message table, replaceable for translation.
 * @param declares - Whether a schema at a path declares a key; without it no unknown-key error is
 *   dropped.
 * @returns The problems, in the order of the (collapsed) errors.
 */
export function schemaErrorsToProblems(
  p: ParsedText,
  doc: number,
  errors: SchemaError[],
  messages: Partial<SchemaMessages> = defaultMessages,
  declares?: Declares,
): Problem[] {
  const out: Problem[] = [];
  const seen = new Set<string>();
  const declaredAt = declares && ((pointer: string, key: string) => declares(toPath(p, doc, pointer), key));
  for (const e of collapse(errors, declaredAt)) {
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

/** A problem whose message comes from the table entry `key` with `params`; `code` defaults to `key`. */
function problem(
  p: ParsedText,
  doc: number,
  severity: Severity,
  source: Problem['source'],
  key: string,
  messages: Partial<SchemaMessages>,
  params: Record<string, unknown>,
  path: YamlPath,
  [from, to]: Range,
  code = key,
): Problem {
  const message = messageFor({ instancePath: '', keyword: key, params }, messages);
  const { line, col } = toLineCol(p, from);
  return { severity, source, code, message, doc, path, from, to, line, col };
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

/** Applies the collapsing rules described on {@link schemaErrorsToProblems}. */
function collapse(errors: SchemaError[], declaredAt?: (pointer: string, key: string) => boolean): SchemaError[] {
  const wrapperPaths = new Set<string>();
  for (const e of errors) if (WRAPPERS.has(e.keyword)) wrapperPaths.add(e.instancePath);

  const branches = errors.filter((e) => !WRAPPERS.has(e.keyword));
  const specific = errors.filter((e) => !UNKNOWN_KEY.has(e.keyword));
  const kept: SchemaError[] = [];
  for (const e of errors) {
    if (WRAPPERS.has(e.keyword)) {
      if (!branches.some((b) => isUnder(b.instancePath, e.instancePath))) kept.push(e); // nothing more specific
      continue;
    }
    // Shallow-type-drop: a branch failed on shape (e.g. "must be null" next to an object branch
    // whose own fields failed deeper); the deeper errors are the specific ones.
    if (
      e.keyword === 'type' &&
      wrapperPaths.has(e.instancePath) &&
      branches.some((b) => b.instancePath.startsWith(`${e.instancePath}/`))
    ) {
      continue;
    }
    // A declared key reported unknown only because a sibling (or the object itself) failed.
    if (UNKNOWN_KEY.has(e.keyword) && declaredAt) {
      const key = String(e.params['additionalProperty'] ?? e.params['unevaluatedProperty']);
      if (specific.some((o) => isUnder(o.instancePath, e.instancePath)) && declaredAt(e.instancePath, key)) continue;
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
    const names = String(e.params['type']).split(',');
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

/** Decodes one JSON-pointer segment (`~1` is `/`, `~0` is `~`). */
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

/** The root map's first key (rather than the whole document), else the root. */
function firstKeyRange(p: ParsedText, doc: number): Range {
  const root = p.docs[doc]?.contents;
  return (isMap(root) ? rangeOf(root.items[0]?.key) : undefined) ?? rootRange(p, doc);
}

/** Range of the nearest existing node at or above `path`, falling back to the document root. */
function nearestRange(p: ParsedText, doc: number, path: YamlPath): Range {
  for (let k = path.length; k > 0; k--) {
    const r = rangeOf(getNode(p, { doc, path: path.slice(0, k) }));
    if (r) return r;
  }
  return rootRange(p, doc);
}

function toProblem(p: ParsedText, doc: number, e: SchemaError, messages: Partial<SchemaMessages>): Problem {
  const base = toPath(p, doc, e.instancePath);
  let path: YamlPath = base;
  let range: Range;

  if (e.keyword === 'required') {
    // Point at the key of the object that lacks the field; sequence items and the root have no
    // key, so use the object itself (the root: its first key rather than the whole document).
    const key = getPairKey(p, { doc, path: base });
    const node = getNode(p, { doc, path: base });
    if (key) range = rangeOf(key) ?? nearestRange(p, doc, base);
    else if (base.length === 0) range = firstKeyRange(p, doc);
    else range = rangeOf(node) ?? nearestRange(p, doc, base);
  } else if (UNKNOWN_KEY.has(e.keyword)) {
    const prop = String(e.params['additionalProperty'] ?? e.params['unevaluatedProperty']);
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
