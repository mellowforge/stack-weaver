import { describe, expect, it } from 'vitest';
import { isEmptyDocument, toData } from '../../src/document/data.js';
import { yamlDocs } from '../../src/document/internal.js';
import { parseText } from '../../src/document/parse.js';

describe('toData(p, doc)', () => {
  it('returns plain data of the addressed document', () => {
    const p = parseText('a: 1\n---\nb: [x, y]\n');
    expect(toData(p, 0)).toEqual({ a: 1 });
    expect(toData(p, 1)).toEqual({ b: ['x', 'y'] });
  });

  it('expands merge keys without touching the original', () => {
    const p = parseText('base: &b\n  x: 1\n  y: 2\nuse:\n  <<: *b\n  y: 3\n');
    expect(toData(p, 0)).toEqual({ base: { x: 1, y: 2 }, use: { x: 1, y: 3 } });
    expect(yamlDocs(p)[0]!.toJS()).toEqual({ base: { x: 1, y: 2 }, use: { '<<': { x: 1, y: 2 }, y: 3 } });
  });

  it('throws for a missing document', () => {
    expect(() => toData(parseText('a: 1\n'), 4)).toThrow(RangeError);
  });
});

describe('isEmptyDocument(p, doc)', () => {
  it('is true for comment-only and bare-marker documents, false for content', () => {
    const p = parseText('x: 1\n---\n---\nnull_doc: ~\n---\n~\n');
    expect(Array.from({ length: p.docCount }, (_, i) => isEmptyDocument(p, i))).toEqual([false, true, false, false]);
  });

  it('is true for a missing document', () => {
    expect(isEmptyDocument(parseText('a: 1\n'), 2)).toBe(true);
  });
});
