import { Scalar, isAlias, isMap, isNode, isScalar, isSeq, visit } from 'yaml';
import type { CST, Node, YAMLMap, YAMLSeq } from 'yaml';
import { parseText } from './parse.js';
import { getNode, getPairKey, yamlDocs } from './internal.js';
import { renderBlockScalar, renderScalar, renderValue } from './render.js';
import type { NodeRef, ParsedText, ScalarValue, TextChange, YamlPath, YamlValue } from './types.js';

export type { ScalarValue, YamlValue } from './types.js';

/**
 * An edit addressed by node reference.
 * - `set`: replace a scalar's value.
 * - `add`: add `key` to a block map (or turn an empty `{}` / null value into one), or to a flow
 *   map on a single line.
 * - `push`: append to a block sequence (or turn an empty `[]` / null value into one).
 * - `delete`: remove a map pair (addressed by its value) or a sequence item; in a flow collection,
 *   only a pair of a flow map on a single line.
 * - `renameKey`: give a map pair (addressed by its value, like `delete`) the key `key`, in place.
 * - `addDocument`: append `---` and exactly one new document.
 * - `deleteDocument`: remove a whole document together with its `---` marker.
 */
export type EditOp =
  | { readonly op: 'set'; readonly at: NodeRef; readonly value: ScalarValue }
  | { readonly op: 'add'; readonly at: NodeRef; readonly key: string; readonly value: YamlValue }
  | { readonly op: 'push'; readonly at: NodeRef; readonly value: YamlValue }
  | { readonly op: 'delete'; readonly at: NodeRef }
  | { readonly op: 'renameKey'; readonly at: NodeRef; readonly key: string }
  | { readonly op: 'addDocument'; readonly yaml: string }
  | { readonly op: 'deleteDocument'; readonly doc: number };

/**
 * Why an edit cannot be made by splicing text. This union may grow in later versions, so treat an
 * unknown reason like `unsupported` (for example, offer the code editor instead).
 * - `alias`: the target is an alias or sits under one; or the path reaches a key that is missing
 *   from a map holding a `<<` merge key (the value may come from the merge); or a `delete` would
 *   remove an anchor that an alias elsewhere still references; or a `renameKey` is in a map holding
 *   a `<<` merge key, or would rename a key that is an alias or carries an anchor still aliased;
 * - `flow`: a structural edit of a non-empty flow collection (`{ }` / `[ ]`), or of anything
 *   inside a flow collection. Supported: `set` of a scalar anywhere in one, and `add` / `delete`
 *   of a pair in a flow map that sits on one line (with any flow collections around it maps on
 *   that same line, so no comment inside), where `add` takes a value that renders on one line (a
 *   scalar other than a multi-line string, a list of such scalars, or a map of them). Everything
 *   else stays `flow`: flow sequences, multi-line flow maps, `renameKey`, and a deeper value;
 * - `block-scalar`: the target is a block scalar with an explicit indentation indicator;
 * - `not-found`: no node at the reference;
 * - `parse-error`: the text has parse errors, or the `addDocument` snippet does not parse;
 * - `duplicate-key`: `add` or `renameKey` to a key the map already has;
 * - `unsupported`: anything else, including a value that is not a {@link YamlValue} and a result
 *   that would not re-parse as intended.
 */
export type EditRefusal =
  | 'alias'
  | 'flow'
  | 'block-scalar'
  | 'not-found'
  | 'parse-error'
  | 'duplicate-key'
  | 'unsupported';

/**
 * The new text plus the single splice that produced it and the new text's parse, or the reason
 * the edit was refused. `parsed` is the `parseText` result for `text` (the input parse itself
 * when the text is unchanged), so a caller need not parse it again. For the ops that create or
 * move a node, `at` addresses it in the new text: `add` gives `[...path, key]`, `push` gives
 * `[...path, index]`, `renameKey` gives the pair's value under its new key and `addDocument` gives
 * `{ doc: <new index>, path: [] }`. Other ops leave `at` out.
 */
export type EditResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly change: TextChange;
      readonly parsed: ParsedText;
      readonly at?: NodeRef;
    }
  | { readonly ok: false; readonly reason: EditRefusal };

type Coll = YAMLMap | YAMLSeq;

interface Target {
  node: Node;
  /** Ancestor nodes from the document root down to the parent. */
  chain: Node[];
  /** True when any ancestor is a flow collection. */
  inFlow: boolean;
}

const refuse = (reason: EditRefusal): EditResult => ({ ok: false, reason });
const isFlow = (n: unknown): boolean => (isMap(n) || isSeq(n)) && n.flow === true;
const isNull = (n: Node): boolean => isScalar(n) && n.value === null;
const isBlockScalar = (n: Node): boolean =>
  isScalar(n) && (n.type === Scalar.BLOCK_LITERAL || n.type === Scalar.BLOCK_FOLDED);

// ---- line helpers (all offsets are UTF-16 indexes) ----

const lineStart = (t: string, off: number): number => t.lastIndexOf('\n', off - 1) + 1;
const col = (t: string, off: number): number => off - lineStart(t, off);
/** Offset where the line holding `off` ends, before its `\n` or `\r\n` (or the text length). */
function lineEnd(t: string, off: number): number {
  const i = t.indexOf('\n', off);
  if (i < 0) return t.length;
  return t[i - 1] === '\r' ? i - 1 : i;
}
const nextLineStart = (t: string, off: number): number => t.indexOf('\n', off) + 1 || t.length;
/** End of the last content line of a range ending at `end` (ranges may include the final break). */
const lastLineEnd = (t: string, end: number): number =>
  lineEnd(t, end > 0 && t[end - 1] === '\n' ? end - 1 : end);

/**
 * End of an item's last own line: the line holding its content end, plus following comment lines
 * indented deeper than the item (they belong to it). Blank lines and shallower comments stop it.
 */
function ownEnd(t: string, itemCol: number, contentEnd: number): number {
  let end = lastLineEnd(t, contentEnd);
  while (end < t.length) {
    const next = nextLineStart(t, end);
    const le = lineEnd(t, next);
    const line = t.slice(next, le);
    const body = line.trimStart();
    if (!body.startsWith('#') || line.length - body.length <= itemCol) break;
    end = le;
  }
  return end;
}

// ---- values ----

const isScalarValue = (v: unknown): v is ScalarValue =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/**
 * True when `v` is a {@link YamlValue}: scalars, dense arrays and plain (or null-prototype)
 * objects without symbol keys, all the way down and without cycles. `stack` holds the objects
 * being visited, so shared (non-cyclic) references are accepted.
 */
function isYamlValue(v: unknown, stack: Set<object> = new Set()): boolean {
  if (isScalarValue(v)) return true;
  if (typeof v !== 'object' || stack.has(v)) return false;
  stack.add(v);
  try {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!(i in v) || !isYamlValue(v[i], stack)) return false;
      return true;
    }
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    if (Object.getOwnPropertySymbols(v).length > 0) return false;
    return Object.values(v).every((x) => isYamlValue(x, stack));
  } finally {
    stack.delete(v);
  }
}

// ---- data post-checks ----

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural equality of plain data as `toJS` produces it (NaN equals NaN). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (a instanceof Map || a instanceof Set || ArrayBuffer.isView(a)) {
    return Object.getPrototypeOf(a) === Object.getPrototypeOf(b) && sameData([...(a as Iterable<unknown>)], [...(b as Iterable<unknown>)]);
  }
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  if (!isRecord(a) || !isRecord(b) || Array.isArray(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameData(a[k], b[k]));
}

/** The value at `path` inside plain document data; map keys are looked up as strings. */
function dataAt(data: unknown, path: YamlPath): unknown {
  let cur = data;
  for (const seg of path) {
    if (Array.isArray(cur) && typeof seg === 'number') cur = cur[seg];
    else if (isRecord(cur)) cur = cur[String(seg)];
    else return undefined;
  }
  return cur;
}

/**
 * Builds a post-check that compares every document's data after the edit with the data before
 * it, changed only by `mutate`. `mutate` edits the old data of document `doc` in place (aliased
 * collections share one object, so aliases see the change too) and returns the replacement for
 * the whole document, or `undefined` when the expected data cannot be built.
 */
function dataCheck(
  p: ParsedText,
  doc: number,
  mutate: (data: unknown) => { data: unknown } | undefined,
): (q: ParsedText) => boolean {
  const expected = yamlDocs(p).map((d) => d.toJS() as unknown);
  const next = mutate(expected[doc]);
  if (!next) return () => false;
  expected[doc] = next.data;
  return (q) =>
    q.docCount === expected.length && sameData(expected, yamlDocs(q).map((d) => d.toJS() as unknown));
}

/** Replaces the value at `path` (a fresh value where the old one was a scalar). */
function replaceAt(data: unknown, path: YamlPath, value: unknown): { data: unknown } | undefined {
  if (path.length === 0) return { data: value };
  const parent = dataAt(data, path.slice(0, -1));
  const last = path[path.length - 1]!;
  if (Array.isArray(parent) && typeof last === 'number') parent[last] = value;
  else if (isRecord(parent)) parent[String(last)] = value;
  else return undefined;
  return { data };
}

// ---- locating targets ----

function locate(p: ParsedText, ref: NodeRef): Target | EditRefusal {
  if (!p.ok) return 'parse-error';
  const chain: Node[] = [];
  for (let i = 0; i <= ref.path.length; i++) {
    const n = getNode(p, { doc: ref.doc, path: ref.path.slice(0, i) });
    if (!n) {
      const parent = chain[chain.length - 1];
      const merges =
        isMap(parent) && parent.items.some((pr) => isScalar(pr.key) && pr.key.value === '<<');
      return merges ? 'alias' : 'not-found';
    }
    if (isAlias(n)) return 'alias';
    if (i === ref.path.length) return { node: n, chain, inFlow: chain.some(isFlow) };
    chain.push(n);
  }
  return 'not-found';
}

function hasIndentIndicator(p: ParsedText, n: Node): boolean {
  if (!isBlockScalar(n)) return false;
  const start = n.range![0];
  return /^[|>][-+]?[1-9]/.test(p.text.slice(start, lineEnd(p.text, start)));
}

/**
 * Reports whether the node at `ref` can be edited by splicing its source text. The operation is
 * not known here, so the answer is permissive: `undefined` means at least one edit of the node
 * itself is possible.
 * - A scalar is editable (also inside a flow collection, where `set` works), unless it is a block
 *   scalar with an indentation indicator (`block-scalar`).
 * - A block collection is editable, and so is an empty `{}` / `[]`, which `add` / `push` turn
 *   into a block collection.
 * - A non-empty flow collection, or a collection inside a flow collection, reports `flow`.
 *
 * `applyEdit` makes the operation-specific decision: for example, deleting a block-map pair whose
 * value is a flow collection is allowed although the value reports `flow` here, so are `add` and
 * `delete` of a pair in a single-line flow map, and deleting a node whose anchor is still aliased
 * is refused as `alias` although it reports editable here.
 *
 * @param p - The parsed text.
 * @param ref - The node to check.
 * @returns `undefined` when the node is editable, otherwise the reason edits are refused.
 */
export function canEdit(p: ParsedText, ref: NodeRef): EditRefusal | undefined {
  try {
    const t = locate(p, ref);
    if (typeof t === 'string') return t;
    if (isScalar(t.node)) return hasIndentIndicator(p, t.node) ? 'block-scalar' : undefined;
    if (t.inFlow) return 'flow';
    if (isFlow(t.node)) return (t.node as Coll).items.length === 0 ? undefined : 'flow';
    return undefined;
  } catch {
    return 'unsupported';
  }
}

// ---- items of block collections ----

interface Item {
  /** Offset of the key (map) or the `-` indicator (sequence). */
  start: number;
  col: number;
  /** End of the item's content, as reported by the parser. */
  contentEnd: number;
  /** Spaces between `-` and the item content (sequences only). */
  gap: number;
}

function itemInfo(t: string, parent: Coll, idx: number): Item | undefined {
  if (isMap(parent)) {
    const pr = parent.items[idx];
    const key = pr?.key as Node | null | undefined;
    if (!key?.range) return undefined;
    const value = pr!.value as Node | null;
    const start = key.range[0];
    return { start, col: col(t, start), contentEnd: value?.range?.[1] ?? key.range[1], gap: 0 };
  }
  const node = parent.items[idx] as Node | undefined;
  if (!node?.range) return undefined;
  const tok = (parent.srcToken as CST.BlockSequence | undefined)?.items[idx]?.start ?? [];
  const k = tok.findIndex((s) => s.type === 'seq-item-ind');
  const space = tok[k + 1];
  const start = k >= 0 ? tok[k]!.offset : node.range[0];
  const gap = k >= 0 && space?.type === 'space' ? space.source.length : 1;
  return { start, col: col(t, start), contentEnd: node.range[1], gap };
}

// ---- pairs of single-line flow maps ----

interface FlowSpan {
  /** Offset of the map's `{`. */
  open: number;
  /** Offset of the map's `}`. */
  close: number;
}

/**
 * The braces of flow map `m` when `m` and every flow collection around it (its ancestors in
 * `chain`) are maps that sit on one line, otherwise `undefined`. One line also means no comment
 * inside: a comment runs to the end of its line.
 */
function oneLineFlowMap(t: string, m: YAMLMap, chain: readonly Node[]): FlowSpan | undefined {
  const flows = [...chain.filter(isFlow), m];
  if (!flows.every(isMap)) return undefined;
  const [s, e] = flows[0]!.range!;
  if (/[\r\n]/.test(t.slice(s, e))) return undefined;
  const open = m.range![0];
  const close = m.range![1] - 1;
  return t[open] === '{' && t[close] === '}' ? { open, close } : undefined;
}

/**
 * True when the node at `ref` is a flow map whose pairs `add` and `delete` can splice: it and every
 * flow collection around it are maps, and the outermost one sits on one line.
 * @internal Shared with the corpus tests; not part of the public API.
 */
export function isOneLineFlowMap(p: ParsedText, ref: NodeRef): boolean {
  try {
    const tg = locate(p, ref);
    return typeof tg !== 'string' && isMap(tg.node) && tg.node.flow === true && oneLineFlowMap(p.text, tg.node, tg.chain) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Where each pair of a one-line flow map starts (after the preceding `,` and spaces, so at its
 * props or key) and ends (after its value, its `:` when the value is empty, or its key when it has
 * no `:`). `undefined` when the text between pairs is not a plain `,` separator.
 */
function flowPairs(t: string, m: YAMLMap, span: FlowSpan): { start: number; end: number }[] | undefined {
  const skip = (i: number): number => {
    while (t[i] === ' ' || t[i] === '\t') i++;
    return i;
  };
  const out: { start: number; end: number }[] = [];
  let at = skip(span.open + 1);
  for (const pr of m.items) {
    if (out.length > 0) {
      if (t[at] !== ',') return undefined;
      at = skip(at + 1);
    }
    let end = (pr.value as Node | null)?.range?.[1] ?? (pr.key as Node | null)?.range?.[1];
    if (end === undefined || end < at) return undefined;
    // An empty (null) value's range sits after the spaces that follow its `:`.
    while (end > at && (t[end - 1] === ' ' || t[end - 1] === '\t')) end--;
    out.push({ start: at, end });
    at = skip(end);
  }
  return out;
}

/** A single-line flow rendering of a scalar, a list of scalars or a map of scalars; else `undefined`. */
function flowValue(value: YamlValue): string | undefined {
  const scalar = (v: unknown): string | undefined =>
    isScalarValue(v) && !(typeof v === 'string' && /[\r\n]/.test(v)) ? renderScalar(v, { flow: true }) : undefined;
  if (isScalarValue(value)) return scalar(value);
  const parts = Array.isArray(value)
    ? value.map(scalar)
    : Object.entries(value).map(([k, v]) => {
        const out = scalar(v);
        return out === undefined ? undefined : `${renderKey(k, undefined, true)}: ${out}`;
      });
  if (parts.some((x) => x === undefined)) return undefined;
  if (Array.isArray(value)) return `[${parts.join(', ')}]`;
  return parts.length > 0 ? `{ ${parts.join(', ')} }` : '{}';
}

/** `add` to a flow map: `, key: value` after the last pair, or `{ key: value }` for an empty one. */
function addFlowPair(p: ParsedText, ref: NodeRef, tg: Target, n: YAMLMap, key: string, value: YamlValue): EditResult {
  const t = p.text;
  const span = oneLineFlowMap(t, n, tg.chain);
  if (!span) return refuse('flow');
  if (n.items.some((pr) => isScalar(pr.key) && String(pr.key.value) === key)) return refuse('duplicate-key');
  const rendered = flowValue(value);
  if (rendered === undefined) return refuse('flow');
  const pair = `${renderKey(key, undefined, true)}: ${rendered}`;
  let change: TextChange;
  if (n.items.length === 0) change = { from: span.open + 1, to: span.close, insert: ` ${pair} ` };
  else {
    const last = flowPairs(t, n, span)?.at(-1);
    if (!last) return refuse('unsupported');
    change = { from: last.end, to: last.end, insert: `, ${pair}` };
  }
  return finish(p, change, addedCheck(p, ref, key, value), { doc: ref.doc, path: [...ref.path, key] });
}

/**
 * `delete` of a pair in a flow map: the pair plus one adjacent separator (the following one, or
 * the preceding one for the last pair); the only pair leaves `{}`.
 */
function deleteFlowPair(p: ParsedText, ref: NodeRef, tg: Target, parent: YAMLMap): EditResult {
  const t = p.text;
  const span = oneLineFlowMap(t, parent, tg.chain.slice(0, -1));
  if (!span) return refuse('flow');
  const idx = parent.items.findIndex((pr) => pr.value === tg.node);
  const pairs = flowPairs(t, parent, span);
  if (idx < 0 || !pairs) return refuse('unsupported');
  if (anchorReferenced(p, ref.doc, [parent.items[idx]!.key, tg.node])) return refuse('alias');
  let change: TextChange;
  if (pairs.length === 1) change = { from: span.open + 1, to: span.close, insert: '' };
  else if (idx < pairs.length - 1) change = { from: pairs[idx]!.start, to: pairs[idx + 1]!.start, insert: '' };
  else change = { from: pairs[idx - 1]!.end, to: pairs[idx]!.end, insert: '' };
  return finish(p, change, deletedCheck(p, ref));
}

// ---- operations ----

/** Splices `change`, re-parses, and accepts the result only when it parses and `check` passes. */
function finish(
  p: ParsedText,
  change: TextChange,
  check: (q: ParsedText) => boolean,
  at?: NodeRef,
): EditResult {
  const text = p.text.slice(0, change.from) + change.insert + p.text.slice(change.to);
  const q = parseText(text);
  if (!q.ok || !check(q)) return refuse('unsupported');
  return at ? { ok: true, text, change, parsed: q, at } : { ok: true, text, change, parsed: q };
}

function setScalar(p: ParsedText, ref: NodeRef, tg: Target, value: ScalarValue): EditResult {
  const n = tg.node;
  if (!isScalar(n)) return refuse('unsupported');
  if (hasIndentIndicator(p, n)) return refuse('block-scalar');
  const t = p.text;
  const [s, e] = n.range!;
  let change: TextChange;
  if (isBlockScalar(n)) {
    change = setBlockScalar(p, ref, n, value);
  } else {
    const quote = typeof n.value === 'string' ? n.type : undefined;
    let insert = renderScalar(value, { flow: tg.inFlow, quote });
    if (s === e && s > 0 && !/\s/.test(t[s - 1]!)) insert = ` ${insert}`;
    if (s === e && t[e] === '#') insert = `${insert} `;
    change = { from: s, to: e, insert };
  }
  return finish(p, change, (q) => {
    const m = getNode(q, ref);
    return q.docCount === p.docCount && isScalar(m) && Object.is(m.value, value);
  });
}

/**
 * Rewrites a block scalar in place at the same indentation. When the value cannot be a block
 * scalar (it is not a string, holds a carriage return, starts with whitespace, or is only line
 * breaks), falls back to a single-line scalar on the header line, keeping the header's comment.
 */
function setBlockScalar(p: ParsedText, ref: NodeRef, n: Scalar, value: ScalarValue): TextChange {
  const t = p.text;
  const [s, e] = n.range!;
  const header = /^([|>])([-+]?)(.*)$/.exec(t.slice(s, lineEnd(t, s)))!;
  const breaks = /(\r?\n)*$/.exec(t.slice(s, e))![0];
  const nBreaks = breaks.split('\n').length - 1;
  if (typeof value === 'string') {
    const body = t.slice(nextLineStart(t, s), e - breaks.length);
    const firstLine = body.split('\n').find((l) => l.trim() !== '');
    const key = getPairKey(p, ref);
    const indent = firstLine
      ? firstLine.length - firstLine.trimStart().length
      : (key ? col(t, key.range![0]) : col(t, s)) + 2;
    const block = renderBlockScalar(value, header[1] === '>', header[3]!, indent, p.eol);
    if (block !== undefined) {
      const keep = header[2] === '+' || /\n\n$/.test(value);
      const extra = keep ? 0 : Math.max(0, nBreaks - 1);
      return { from: s, to: e, insert: block + (nBreaks > 0 ? p.eol : '') + p.eol.repeat(extra) };
    }
  }
  const comment = header[3]!.trim();
  const insert = renderScalar(value) + (comment ? ` ${comment}` : '');
  return { from: s, to: e - breaks.length, insert };
}

/**
 * Replaces an empty flow collection or a null value with a block collection, always 2 spaces of
 * indentation. For a map value, the collection goes on the next line, 2 spaces deeper than the
 * key (anything after the value on its line, such as a comment, stays on the key's line). For a
 * sequence item or the document root, it stays in place and its continuation lines use the node's
 * own column. `render(col)` renders the new collection with continuation lines at `col`.
 */
function toBlock(
  p: ParsedText,
  tg: Target,
  ref: NodeRef,
  render: (col: number) => string,
): TextChange | undefined {
  const t = p.text;
  const [s, e] = tg.node.range!;
  const parent = tg.chain[tg.chain.length - 1];
  if (isMap(parent)) {
    const key = getPairKey(p, ref);
    if (!key?.range) return undefined;
    const c = col(t, key.range[0]) + 2;
    let from = s;
    while (from > 0 && (t[from - 1] === ' ' || t[from - 1] === '\t')) from--;
    const le = lineEnd(t, e);
    const rest = t.slice(e, le).trim();
    const insert = `${rest ? ` ${rest}` : ''}${p.eol}${' '.repeat(c)}${render(c)}`;
    return { from, to: le, insert };
  }
  const insert = render(col(t, s));
  const glued = s === e && s > 0 && !/\s/.test(t[s - 1]!);
  return { from: s, to: e, insert: glued ? ` ${insert}` : insert };
}

function insertAfterLast(
  p: ParsedText,
  coll: Coll,
  line: (first: Item) => string,
): TextChange | undefined {
  const first = itemInfo(p.text, coll, 0);
  const last = itemInfo(p.text, coll, coll.items.length - 1);
  if (!first || !last) return undefined;
  const at = ownEnd(p.text, last.col, last.contentEnd);
  return { from: at, to: at, insert: p.eol + ' '.repeat(first.col) + line(first) };
}

function addPair(p: ParsedText, ref: NodeRef, tg: Target, key: string, value: YamlValue): EditResult {
  const n = tg.node;
  // An empty `{}` under a block parent becomes a block map (below); inside a flow map it stays flow.
  if (isMap(n) && n.flow && (n.items.length > 0 || tg.inFlow)) return addFlowPair(p, ref, tg, n, key, value);
  if (tg.inFlow) return refuse('flow');
  const entry = (c: number): string => renderValue(new Map([[key, value]]), c, p.eol);
  let change: TextChange | undefined;
  if (isMap(n) && (!n.flow || n.items.length === 0)) {
    const exists = n.items.some((pr) => isScalar(pr.key) && String(pr.key.value) === key);
    if (exists) return refuse('duplicate-key');
    change = n.flow ? toBlock(p, tg, ref, entry) : insertAfterLast(p, n, (f) => entry(f.col));
  } else if (isFlow(n)) {
    return refuse('flow');
  } else if (isNull(n)) {
    change = toBlock(p, tg, ref, entry);
  }
  if (!change) return refuse('unsupported');
  return finish(p, change, addedCheck(p, ref, key, value), { doc: ref.doc, path: [...ref.path, key] });
}

/** The post-check of `add`: the map (or null value) at `ref` gained `key: value`, nothing else changed. */
function addedCheck(p: ParsedText, ref: NodeRef, key: string, value: YamlValue): (q: ParsedText) => boolean {
  return dataCheck(p, ref.doc, (data) => {
    const old = dataAt(data, ref.path);
    if (isRecord(old)) {
      old[key] = value;
      return { data };
    }
    return old === null ? replaceAt(data, ref.path, { [key]: value }) : undefined;
  });
}

function pushItem(p: ParsedText, ref: NodeRef, tg: Target, value: YamlValue): EditResult {
  const n = tg.node;
  if (tg.inFlow) return refuse('flow');
  let change: TextChange | undefined;
  if (isSeq(n) && (!n.flow || n.items.length === 0)) {
    change = n.flow
      ? toBlock(p, tg, ref, (c) => renderValue([value], c, p.eol))
      : insertAfterLast(p, n, (f) => {
          const body = renderValue(value, f.col + 1 + f.gap, p.eol);
          return `-${' '.repeat(f.gap)}${body}`;
        });
  } else if (isFlow(n)) {
    return refuse('flow');
  } else if (isNull(n)) {
    change = toBlock(p, tg, ref, (c) => renderValue([value], c, p.eol));
  }
  if (!change) return refuse('unsupported');
  const check = dataCheck(p, ref.doc, (data) => {
    const old = dataAt(data, ref.path);
    if (Array.isArray(old)) {
      old.push(value);
      return { data };
    }
    return old === null ? replaceAt(data, ref.path, [value]) : undefined;
  });
  const index = isSeq(n) ? n.items.length : 0;
  return finish(p, change, check, { doc: ref.doc, path: [...ref.path, index] });
}

/** Splits the text after a key's `:` into its props (anchor, tag) and its comment. */
function emptyWithRest(rest: string, empty: string): string {
  const hash = rest.search(/(^|\s)#/);
  const props = (hash < 0 ? rest : rest.slice(0, hash)).trim();
  const comment = hash < 0 ? '' : rest.slice(hash).trim();
  return [props, empty, comment].filter(Boolean).join(' ');
}

/** True when `roots` hold an anchor that an alias outside them, in document `doc`, references. */
function anchorReferenced(p: ParsedText, doc: number, roots: unknown[]): boolean {
  const anchors = new Set<string>();
  const inside = new Set<unknown>();
  for (const root of roots) {
    if (!isNode(root)) continue;
    visit(root, {
      Node(_, n) {
        if (n.anchor) anchors.add(n.anchor);
        if (isAlias(n)) inside.add(n);
      },
    });
  }
  if (anchors.size === 0) return false;
  let used = false;
  visit(yamlDocs(p)[doc]!, {
    Alias(_, a) {
      used = !inside.has(a) && anchors.has(a.source);
      return used ? visit.BREAK : undefined;
    },
  });
  return used;
}

function deleteItem(p: ParsedText, ref: NodeRef, tg: Target): EditResult {
  const t = p.text;
  const parent = tg.chain[tg.chain.length - 1];
  if (!isMap(parent) && !isSeq(parent)) return refuse('unsupported');
  if (isMap(parent) && parent.flow) return deleteFlowPair(p, ref, tg, parent);
  if (tg.inFlow) return refuse('flow');
  if (hasIndentIndicator(p, tg.node)) return refuse('block-scalar');
  const idx = isMap(parent)
    ? parent.items.findIndex((pr) => pr.value === tg.node)
    : (ref.path[ref.path.length - 1] as number);
  const item = itemInfo(t, parent, idx);
  if (!item) return refuse('unsupported');
  const key = isMap(parent) ? parent.items[idx]?.key : undefined;
  if (anchorReferenced(p, ref.doc, [key, tg.node])) return refuse('alias');
  const end = ownEnd(t, item.col, item.contentEnd);
  const ls = lineStart(t, item.start);
  const midLine = t.slice(ls, item.start).trim() !== '';
  let change: TextChange;

  if (parent.items.length === 1) {
    const empty = isMap(parent) ? '{}' : '[]';
    const parentRef = { doc: ref.doc, path: ref.path.slice(0, -1) };
    const holder = isMap(tg.chain[tg.chain.length - 2]) ? getPairKey(p, parentRef) : undefined;
    if (holder?.range) {
      const colon = t.indexOf(':', holder.range[1]);
      if (colon < 0) return refuse('unsupported');
      const rest = t.slice(colon + 1, lineEnd(t, colon));
      change = { from: colon + 1, to: end, insert: ` ${emptyWithRest(rest, empty)}` };
    } else {
      change = { from: parent.range![0], to: end, insert: empty };
    }
  } else if (midLine) {
    // The first pair of a map that shares its line with `- `: pull the next sibling up, unless
    // something other than whitespace (such as a comment line) sits between the two.
    const next = idx === 0 ? itemInfo(t, parent, 1) : undefined;
    if (!next || t.slice(end, next.start).trim() !== '') return refuse('unsupported');
    change = { from: item.start, to: next.start, insert: '' };
  } else if (end === t.length) {
    // Last line without a final line break: remove the preceding break instead.
    const from = ls === 0 ? 0 : ls - (t[ls - 2] === '\r' ? 2 : 1);
    change = { from, to: end, insert: '' };
  } else {
    change = { from: ls, to: nextLineStart(t, end), insert: '' };
  }
  return finish(p, change, deletedCheck(p, ref));
}

/** The post-check of `delete`: the pair or item at `ref` is gone, nothing else changed. */
function deletedCheck(p: ParsedText, ref: NodeRef): (q: ParsedText) => boolean {
  return dataCheck(p, ref.doc, (data) => {
    const holder = dataAt(data, ref.path.slice(0, -1));
    const last = ref.path[ref.path.length - 1]!;
    if (Array.isArray(holder) && typeof last === 'number') holder.splice(last, 1);
    else if (isRecord(holder)) delete holder[String(last)];
    else return undefined;
    return { data };
  });
}

/**
 * Renders `key` for the source range of an implicit key. On top of what {@link renderScalar}
 * quotes (with `flow`, also flow indicators), a plain key is double-quoted when it starts with an
 * indicator, holds `: ` or ` #`, ends with `:`, or has whitespace at either end.
 */
function renderKey(key: string, quote: Scalar.Type | undefined, flow = false): string {
  const out = renderScalar(key, { quote, flow });
  if (out.startsWith('"') || out.startsWith("'")) return out;
  if (out === '' || /^[-?:,[\]{}#&*!|>%@`]|:\s|:$|\s#|^\s|\s$/.test(out)) return renderScalar(key, { quote: Scalar.QUOTE_DOUBLE });
  return out;
}

function renamePair(p: ParsedText, ref: NodeRef, tg: Target, key: string): EditResult {
  const parent = tg.chain[tg.chain.length - 1];
  if (ref.path.length === 0 || !isMap(parent)) return refuse('unsupported');
  if (tg.inFlow) return refuse('flow');
  const idx = parent.items.findIndex((pr) => pr.value === tg.node);
  const old = parent.items[idx]?.key as Node | null | undefined;
  if (isAlias(old)) return refuse('alias');
  if (!isScalar(old) || !old.range || isBlockScalar(old)) return refuse('unsupported');
  const parentPath = ref.path.slice(0, -1);
  const at: NodeRef = { doc: ref.doc, path: [...parentPath, key] };
  const [s, e] = old.range;
  if (String(old.value) === key) return { ok: true, text: p.text, change: { from: s, to: s, insert: '' }, parsed: p, at };
  // A merge key supplies values by key: renaming next to one can reveal or hide a merged value.
  if (parent.items.some((pr) => isScalar(pr.key) && pr.key.value === '<<')) return refuse('alias');
  if (parent.items.some((pr) => isScalar(pr.key) && String(pr.key.value) === key)) return refuse('duplicate-key');
  if (anchorReferenced(p, ref.doc, [old])) return refuse('alias');
  const insert = renderKey(key, typeof old.value === 'string' ? old.type : undefined);
  const oldKey = String(ref.path[ref.path.length - 1]);
  const check = dataCheck(p, ref.doc, (data) => {
    const holder = dataAt(data, parentPath);
    if (!isRecord(holder) || !Object.hasOwn(holder, oldKey)) return undefined;
    holder[key] = holder[oldKey];
    delete holder[oldKey];
    return { data };
  });
  // The pair keeps its place: the same index of the same map now holds the new key.
  const inPlace = (q: ParsedText): boolean => {
    const m = getNode(q, { doc: ref.doc, path: parentPath });
    const k = isMap(m) ? m.items[idx]?.key : undefined;
    return isScalar(k) && String(k.value) === key;
  };
  return finish(p, { from: s, to: e, insert }, (q) => check(q) && inPlace(q), at);
}

function addDocument(p: ParsedText, yaml: string): EditResult {
  if (typeof yaml !== 'string') return refuse('unsupported');
  if (!parseText(yaml).ok) return refuse('parse-error');
  const t = p.text;
  let body = yaml.replace(/\r?\n/g, p.eol);
  if (!body.endsWith(p.eol)) body += p.eol;
  const lead = t.length > 0 && !t.endsWith('\n') ? p.eol : '';
  const insert = `${lead}---${p.eol}${body}`;
  const before = yamlDocs(p).map((d) => d.toJS() as unknown);
  return finish(
    p,
    { from: t.length, to: t.length, insert },
    (q) =>
      q.docCount === before.length + 1 &&
      sameData(before, yamlDocs(q).slice(0, before.length).map((d) => d.toJS() as unknown)),
    { doc: before.length, path: [] },
  );
}

/** True when an alias in a document other than `doc` names an anchor defined in `doc`. */
function anchorsReferencedElsewhere(p: ParsedText, doc: number): boolean {
  const anchors = new Set<string>();
  visit(yamlDocs(p)[doc]!, {
    Node(_, n) {
      if (n.anchor) anchors.add(n.anchor);
    },
  });
  if (anchors.size === 0) return false;
  let used = false;
  yamlDocs(p).forEach((d, i) => {
    if (i === doc || used) return;
    visit(d, {
      Alias(_, a) {
        used = anchors.has(a.source);
        return used ? visit.BREAK : undefined;
      },
    });
  });
  return used;
}

/**
 * Removes document `doc`. A document owns everything from its own `---` line up to the next `---`
 * (or the end of the text), so removing it also removes its marker and the comments in between;
 * the first document owns the text from the start. When the first document goes, the marker that
 * follows it goes too, so the next document becomes the first; a comment on that marker's line
 * (`--- # backend`) stays, as a comment line. Bytes outside the removed range are unchanged. The
 * result must hold one document fewer, with the other documents' data unchanged.
 */
function deleteDocument(p: ParsedText, doc: number): EditResult {
  const n = p.docCount;
  if (!Number.isInteger(doc) || doc < 0 || doc >= n) return refuse('not-found');
  if (anchorsReferencedElsewhere(p, doc)) return refuse('alias');
  const t = p.text;
  const start = (i: number): number => (i === 0 ? 0 : yamlDocs(p)[i]!.range[0]);
  const from = start(doc);
  let to: number;
  if (n === 1) to = t.length;
  else if (doc === n - 1) to = t.length;
  else if (doc === 0) {
    // The next document's marker goes too, but a comment after it (`--- # backend`) stays as a line.
    const marker = start(1);
    const rest = t.startsWith('---', marker) ? t.slice(marker + 3, lineEnd(t, marker)) : '';
    to = /^[ \t]+#/.test(rest) ? marker + 3 + rest.indexOf('#') : nextLineStart(t, marker);
  } else to = start(doc + 1);
  const before = yamlDocs(p).map((d) => d.toJS() as unknown);
  before.splice(doc, 1);
  return finish(p, { from, to, insert: '' }, (q) =>
    n === 1
      ? q.text === ''
      : q.docCount === n - 1 && sameData(before, yamlDocs(q).map((d) => d.toJS() as unknown)),
  );
}

function dispatch(p: ParsedText, op: EditOp): EditResult {
  if (!p.ok) return refuse('parse-error');
  switch (op.op) {
    case 'addDocument':
      return addDocument(p, op.yaml);
    case 'deleteDocument':
      return deleteDocument(p, op.doc);
    case 'set': {
      if (!isScalarValue(op.value)) return refuse('unsupported');
      const tg = locate(p, op.at);
      return typeof tg === 'string' ? refuse(tg) : setScalar(p, op.at, tg, op.value);
    }
    case 'add': {
      if (typeof op.key !== 'string' || !isYamlValue(op.value)) return refuse('unsupported');
      const tg = locate(p, op.at);
      return typeof tg === 'string' ? refuse(tg) : addPair(p, op.at, tg, op.key, op.value);
    }
    case 'push': {
      if (!isYamlValue(op.value)) return refuse('unsupported');
      const tg = locate(p, op.at);
      return typeof tg === 'string' ? refuse(tg) : pushItem(p, op.at, tg, op.value);
    }
    case 'delete': {
      const tg = locate(p, op.at);
      if (typeof tg === 'string') return refuse(tg);
      return op.at.path.length === 0 ? refuse('unsupported') : deleteItem(p, op.at, tg);
    }
    case 'renameKey': {
      if (typeof op.key !== 'string') return refuse('unsupported');
      const tg = locate(p, op.at);
      return typeof tg === 'string' ? refuse(tg) : renamePair(p, op.at, tg, op.key);
    }
    default:
      return refuse('unsupported');
  }
}

/**
 * Applies an edit by splicing the source text; the rest of the text is never regenerated.
 *
 * - `set` replaces only the scalar's value range, so comments after it stay. Strings keep their
 *   quote style, are quoted when a plain form would re-type (YAML 1.2 or 1.1), and inside flow
 *   collections are quoted when they contain flow indicators. Block scalars are rewritten as block
 *   scalars at the same indentation; a value that cannot be a block scalar becomes a single-line
 *   scalar on the header line, keeping the header's comment.
 * - `add` / `push` insert after the last line of the collection (including the last child's deeper
 *   comment lines), indented like the first child. An empty `{}` / `[]` or null value becomes a
 *   block collection with 2-space indentation: for a map value, on the next line 2 spaces deeper
 *   than the key; for a sequence item or the document root, in place at the node's own column.
 *   `add` with an existing key is `duplicate-key`.
 * - In a flow map on a single line, `add` inserts `, key: value` after the last pair (or fills an
 *   empty `{}` / `{ }` inside such a map as `{ key: value }`), with the value in flow style: scalars
 *   quoted as for `set` inside a flow collection, a list of scalars as `[a, b]`, a map of scalars
 *   as `{ k: v }`; a value that needs more than one line is `flow`. `delete` removes the pair plus
 *   one adjacent `,` separator (the following one, or the preceding one for the last pair), and the
 *   only pair leaves `{}`. Nothing else on the line changes.
 * - `delete` removes the item's lines plus its deeper trailing comment lines; an only child leaves
 *   `{}` / `[]`. The first pair of a map on a `- ` line is removed by pulling the next pair up,
 *   which is refused (`unsupported`) when anything but whitespace, such as a comment line, sits
 *   between them. Deleting a node that carries an anchor still aliased elsewhere is `alias`.
 * - `renameKey` replaces only the key scalar's source range, so the pair keeps its place, its
 *   comments and the key's anchor or tag. The key keeps its quote style, and is double-quoted when a
 *   plain key would not read back as the same string. Renaming to the current key changes nothing.
 *   A key the map already has is `duplicate-key`; a key inside a flow map is `flow`; a map with a
 *   `<<` merge key, an alias key, or a key whose anchor is still aliased is `alias`; a block scalar
 *   or non-scalar key is `unsupported`.
 * - `addDocument` appends `---` and the YAML (line endings normalized, a final line break
 *   ensured). The snippet must parse (`parse-error` otherwise), and the result must hold exactly
 *   one more document with the earlier documents' data unchanged (`unsupported` otherwise).
 * - `deleteDocument` removes the document from its own `---` line up to the next `---` (for the
 *   first document, up to and including the next marker, keeping a comment on the marker's line).
 *   An out-of-range `doc` is `not-found`;
 *   the result must hold one document fewer with the others' data unchanged (`unsupported`
 *   otherwise).
 *
 * Every result is re-parsed and checked: it must parse with every alias resolving, and for `add`,
 * `push`, `delete` and `renameKey` every document's data must equal the old data with only the
 * intended change (for `renameKey`, also with the pair at its old index). A splice that would not read back as intended is refused as `unsupported`. New line
 * breaks use the text's own line ending.
 *
 * Never throws: a value that is not a {@link YamlValue} (or, for `set`, a {@link ScalarValue}), a
 * malformed operation, or any internal failure gives `unsupported`.
 *
 * @param p - The parsed text.
 * @param op - The edit.
 * @returns The new text, the splice and the new text's parse, or the refusal reason.
 */
export function applyEdit(p: ParsedText, op: EditOp): EditResult {
  try {
    return dispatch(p, op);
  } catch {
    return refuse('unsupported');
  }
}
