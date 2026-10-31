import { describe, expect, it } from 'vitest';
import { applyEdit, isOneLineFlowMap } from '../../src/document/edit.js';
import type { EditOp } from '../../src/document/edit.js';
import { parseText } from '../../src/document/parse.js';
import { yamlDocs } from '../../src/document/internal.js';

const at = (...path: (string | number)[]) => ({ doc: 0, path });
const data = (text: string): unknown => yamlDocs(parseText(text)).map((d) => d.toJS() as unknown);

/** Applies `op`, failing on a refusal; checks the splice, the re-parse, and the expected data. */
function edit(text: string, op: EditOp, expected?: unknown): string {
  const r = applyEdit(parseText(text), op);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  expect(r.text).toBe(text.slice(0, r.change.from) + r.change.insert + text.slice(r.change.to));
  expect(parseText(r.text).ok).toBe(true);
  if (expected !== undefined) expect(data(r.text)).toEqual([expected]);
  return r.text;
}

function refusal(text: string, op: EditOp): string {
  const r = applyEdit(parseText(text), op);
  return r.ok ? 'ok' : r.reason;
}

const del = (...path: (string | number)[]): EditOp => ({ op: 'delete', at: at(...path) });
const add = (path: (string | number)[], key: string, value: unknown): EditOp =>
  ({ op: 'add', at: at(...path), key, value }) as EditOp;

describe('applyEdit: delete in a single-line flow map', () => {
  const text = 'x: 1\nm: { a: 1, b: 2, c: 3 }\ny: 2\n';

  it('removes the first, a middle and the last pair with one separator', () => {
    expect(edit(text, del('m', 'a'), { x: 1, m: { b: 2, c: 3 }, y: 2 })).toBe('x: 1\nm: { b: 2, c: 3 }\ny: 2\n');
    expect(edit(text, del('m', 'b'), { x: 1, m: { a: 1, c: 3 }, y: 2 })).toBe('x: 1\nm: { a: 1, c: 3 }\ny: 2\n');
    expect(edit(text, del('m', 'c'), { x: 1, m: { a: 1, b: 2 }, y: 2 })).toBe('x: 1\nm: { a: 1, b: 2 }\ny: 2\n');
  });

  it('the only pair leaves {}', () => {
    expect(edit('m: { a: 1 }\nn: 2\n', del('m', 'a'), { m: {}, n: 2 })).toBe('m: {}\nn: 2\n');
    expect(edit('m: {a: 1}\n', del('m', 'a'))).toBe('m: {}\n');
  });

  it('keeps compact spacing, a trailing comma, and the props of the next key', () => {
    expect(edit('m: {a: 1,b: 2}\n', del('m', 'a'))).toBe('m: {b: 2}\n');
    expect(edit('m: {a: 1,b: 2}\n', del('m', 'b'))).toBe('m: {a: 1}\n');
    expect(edit('m: { a: 1, b: 2, }\n', del('m', 'b'))).toBe('m: { a: 1, }\n');
    expect(edit('m: { a: 1, &k b: 2 }\nn: *k\n', del('m', 'a'))).toBe('m: { &k b: 2 }\nn: *k\n');
  });

  it('works on a root flow map and a flow map in a sequence item', () => {
    expect(edit('{ a: 1, b: 2 }\n', del('a'), { b: 2 })).toBe('{ b: 2 }\n');
    expect(edit('- { a: 1, b: 2 }\n', del(0, 'b'), [{ a: 1 }])).toBe('- { a: 1 }\n');
  });

  it('works in a flow map nested in a single-line flow map', () => {
    expect(edit('v: { a: { k: 1 }, b: 2 }\n', del('v', 'a', 'k'), { v: { a: {}, b: 2 } })).toBe('v: { a: {}, b: 2 }\n');
    expect(edit('v: { a: { k: 1 }, b: 2 }\n', del('v', 'a'), { v: { b: 2 } })).toBe('v: { b: 2 }\n');
  });

  it('keeps CRLF and leaves other lines byte-identical', () => {
    const crlf = 'x: 1\r\nm: { a: 1, b: 2 }\r\ny: 2\r\n';
    expect(edit(crlf, del('m', 'a'))).toBe('x: 1\r\nm: { b: 2 }\r\ny: 2\r\n');
    expect(edit(crlf, del('m', 'b'))).toBe('x: 1\r\nm: { a: 1 }\r\ny: 2\r\n');
  });

  it('keeps a comment after the closing brace', () => {
    expect(edit('m: { a: 1, b: 2 } # note\n', del('m', 'b'))).toBe('m: { a: 1 } # note\n');
    expect(edit('m: { a: 1, b: 2 } # note\n', add(['m'], 'c', 3))).toBe('m: { a: 1, b: 2, c: 3 } # note\n');
  });

  it('a pair with an empty (null) value ends after its colon', () => {
    expect(edit('m: { a: , b: 2 }\n', del('m', 'b'), { m: { a: null } })).toBe('m: { a: }\n');
    expect(edit('m: { a: , b: 2 }\n', del('m', 'a'), { m: { b: 2 } })).toBe('m: { b: 2 }\n');
    expect(edit('m: { a: }\n', add(['m'], 'c', 1), { m: { a: null, c: 1 } })).toBe('m: { a:, c: 1 }\n');
  });

  it('uses UTF-16 offsets', () => {
    expect(edit('m: { é: "😀", b: 2 }\n', del('m', 'b'))).toBe('m: { é: "😀" }\n');
    expect(edit('m: { é: "😀", b: 2 }\n', del('m', 'é'))).toBe('m: { b: 2 }\n');
  });

  it('refuses a pair whose anchor is still aliased', () => {
    expect(refusal('m: { a: &x 1, b: 2 }\nn: *x\n', del('m', 'a'))).toBe('alias');
  });
});

describe('applyEdit: add in a single-line flow map', () => {
  it('appends before the closing brace with a separator', () => {
    const r = applyEdit(parseText('x: 1\nm: { a: 1 }\ny: 2\n'), add(['m'], 'b', 2));
    expect(r).toMatchObject({ ok: true, text: 'x: 1\nm: { a: 1, b: 2 }\ny: 2\n', at: at('m', 'b') });
    expect(edit('m: {a: 1}\n', add(['m'], 'b', 2), { m: { a: 1, b: 2 } })).toBe('m: {a: 1, b: 2}\n');
    expect(edit('m: { a: 1, }\n', add(['m'], 'b', 2))).toBe('m: { a: 1, b: 2, }\n');
    expect(edit('{ a: 1 }\n', add([], 'b', true), { a: 1, b: true })).toBe('{ a: 1, b: true }\n');
  });

  it('quotes string values and keys the way a flow scalar needs', () => {
    expect(edit('m: { a: 1 }\n', add(['m'], 'd', 'Public port'))).toBe('m: { a: 1, d: Public port }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'd', 'x, y'), { m: { a: 1, d: 'x, y' } })).toBe('m: { a: 1, d: "x, y" }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'd', 'yes'), { m: { a: 1, d: 'yes' } })).toBe('m: { a: 1, d: "yes" }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'd', '8080'), { m: { a: 1, d: '8080' } })).toBe('m: { a: 1, d: "8080" }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'u', 'http://h/{x}'), { m: { a: 1, u: 'http://h/{x}' } })).toBe(
      'm: { a: 1, u: "http://h/{x}" }\n',
    );
    expect(edit('m: { a: 1 }\n', add(['m'], 'k,1', 2), { m: { a: 1, 'k,1': 2 } })).toBe('m: { a: 1, "k,1": 2 }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'z', null), { m: { a: 1, z: null } })).toBe('m: { a: 1, z: null }\n');
    // `n` is a boolean in YAML 1.1, so the key is quoted, like any scalar the writer quotes.
    expect(edit('m: { a: 1 }\n', add(['m'], 'n', 1), { m: { a: 1, n: 1 } })).toBe('m: { a: 1, "n": 1 }\n');
  });

  it('renders a list of scalars as [a, b] and a map of scalars as { k: v }', () => {
    expect(edit('m: { a: 1 }\n', add(['m'], 'enum', ['a', 'b']), { m: { a: 1, enum: ['a', 'b'] } })).toBe(
      'm: { a: 1, enum: [a, b] }\n',
    );
    expect(edit('m: { a: 1 }\n', add(['m'], 'l', ['x,y', 'no', 3]), { m: { a: 1, l: ['x,y', 'no', 3] } })).toBe(
      'm: { a: 1, l: ["x,y", "no", 3] }\n',
    );
    expect(edit('m: { a: 1 }\n', add(['m'], 'l', []))).toBe('m: { a: 1, l: [] }\n');
    expect(edit('m: { a: 1 }\n', add(['m'], 'o', { k: 'v', num: 1 }), { m: { a: 1, o: { k: 'v', num: 1 } } })).toBe(
      'm: { a: 1, o: { k: v, num: 1 } }\n',
    );
    expect(edit('m: { a: 1 }\n', add(['m'], 'o', {}))).toBe('m: { a: 1, o: {} }\n');
  });

  it('fills an empty {} / { } nested in a single-line flow map', () => {
    expect(edit('v: { a: {} }\n', add(['v', 'a'], 'k', 1), { v: { a: { k: 1 } } })).toBe('v: { a: { k: 1 } }\n');
    expect(edit('v: { a: { } }\n', add(['v', 'a'], 'k', 1))).toBe('v: { a: { k: 1 } }\n');
  });

  it('an empty {} under a block parent still becomes a block map', () => {
    expect(edit('a: {}\n', add(['a'], 'k', 1))).toBe('a:\n  k: 1\n');
    expect(edit('a: { }\n', add(['a'], 'k', 1))).toBe('a:\n  k: 1\n');
  });

  it('keeps CRLF and UTF-16 offsets', () => {
    expect(edit('x: 1\r\nm: { a: 1 }\r\ny: 2\r\n', add(['m'], 'b', 'c'))).toBe('x: 1\r\nm: { a: 1, b: c }\r\ny: 2\r\n');
    expect(edit('m: { é: "😀" }\n', add(['m'], 'b', 2))).toBe('m: { é: "😀", b: 2 }\n');
  });

  it('refuses a duplicate key, and values that do not fit on one line', () => {
    expect(refusal('m: { a: 1 }\n', add(['m'], 'a', 2))).toBe('duplicate-key');
    expect(refusal('m: { a: 1 }\n', add(['m'], 'd', 'two\nlines'))).toBe('flow');
    expect(refusal('m: { a: 1 }\n', add(['m'], 'o', { k: { x: 1 } }))).toBe('flow');
    expect(refusal('m: { a: 1 }\n', add(['m'], 'l', [['x']]))).toBe('flow');
    expect(refusal('m: { a: 1 }\n', add(['m'], 'l', [{ k: 1 }]))).toBe('flow');
  });
});

describe('applyEdit: flow edits that stay refused', () => {
  it('a multi-line flow map', () => {
    const text = 'm: { a: 1,\n  b: 2 }\n';
    expect(refusal(text, del('m', 'b'))).toBe('flow');
    expect(refusal(text, del('m', 'a'))).toBe('flow');
    expect(refusal(text, add(['m'], 'c', 3))).toBe('flow');
  });

  it('a flow map with a comment inside', () => {
    const text = 'm: { a: 1, # one\n  b: 2 }\n';
    expect(refusal(text, del('m', 'a'))).toBe('flow');
    expect(refusal(text, add(['m'], 'c', 3))).toBe('flow');
  });

  it('a single-line flow map inside a multi-line flow map', () => {
    expect(refusal('m: { a: { k: 1, j: 2 },\n  b: 2 }\n', del('m', 'a', 'k'))).toBe('flow');
  });

  it('flow sequences, and flow maps inside them', () => {
    expect(refusal('v: [a, b]\n', del('v', 0))).toBe('flow');
    expect(refusal('v: [a, b]\n', { op: 'push', at: at('v'), value: 'c' })).toBe('flow');
    expect(refusal('v: [{ a: 1, b: 2 }]\n', del('v', 0, 'a'))).toBe('flow');
    expect(refusal('v: [{ a: 1 }]\n', add(['v', 0], 'b', 2))).toBe('flow');
  });

  it('renameKey in a flow map', () => {
    expect(refusal('m: { a: 1, b: 2 }\n', { op: 'renameKey', at: at('m', 'a'), key: 'c' })).toBe('flow');
  });
});

describe('isOneLineFlowMap', () => {
  it('matches the maps whose pairs add and delete splice', () => {
    const yes = (text: string, ...path: (string | number)[]) => isOneLineFlowMap(parseText(text), at(...path));
    expect(yes('v: { a: 1 }\n', 'v')).toBe(true);
    expect(yes('v: { a: { k: 1 } }\n', 'v', 'a')).toBe(true);
    expect(yes('v: {}\n', 'v')).toBe(true);
    expect(yes('v: [{ a: 1 }]\n', 'v', 0)).toBe(false);
    expect(yes('v: { a: 1,\n  b: 2 }\n', 'v')).toBe(false);
    expect(yes('v: { a: { k: 1 },\n  b: 2 }\n', 'v', 'a')).toBe(false);
    expect(yes('v:\n  a: 1\n', 'v')).toBe(false);
    expect(yes('v: [a]\n', 'v')).toBe(false);
    expect(yes('v: [\n', 'v')).toBe(false);
  });
});
