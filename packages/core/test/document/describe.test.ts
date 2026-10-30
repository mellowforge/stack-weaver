import { describe, expect, it } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { parseText } from '../../src/document/parse.js';

const d = (text: string, ...path: (string | number)[]) => describeNode(parseText(text), { doc: 0, path });

describe('describeNode', () => {
  it('lists map keys in source order, numeric keys as strings', () => {
    const v = d('z: 1\n8080: x\na: 2\n');
    expect(v?.type).toBe('map');
    expect(v?.keys).toEqual(['z', '8080', 'a']);
    expect(v?.flow).toBe(false);
    expect(v?.readOnly).toBeUndefined();
  });

  it('describes a scalar with its value and ranges', () => {
    const text = 'name: web\n';
    const v = d(text, 'name');
    expect(v?.type).toBe('scalar');
    expect(v?.value).toBe('web');
    expect(text.slice(v!.range.from, v!.range.to)).toBe('web');
    expect(text.slice(v!.keyRange!.from, v!.keyRange!.to)).toBe('name');
    expect(v?.keys).toBeUndefined();
    expect(v?.length).toBeUndefined();
  });

  it('has no keyRange for roots and sequence items', () => {
    expect(d('a: 1\n')?.keyRange).toBeUndefined();
    expect(d('- x\n- y\n', 1)?.keyRange).toBeUndefined();
  });

  it('describes numbers, booleans and null', () => {
    expect(d('a: 3\n', 'a')?.value).toBe(3);
    expect(d('a: true\n', 'a')?.value).toBe(true);
    expect(d('a:\n', 'a')?.value).toBeNull();
  });

  it('reports sequence length', () => {
    const v = d('s:\n  - a\n  - b\n  - c\n', 's');
    expect(v?.type).toBe('seq');
    expect(v?.length).toBe(3);
  });

  it('marks flow collections and nodes inside them', () => {
    const text = 'm: { a: 1, b: [x] }\n';
    expect(d(text, 'm')?.flow).toBe(true);
    expect(d(text, 'm', 'a')?.flow).toBe(true);
    expect(d(text, 'm', 'b', 0)?.flow).toBe(true);
    expect(d(text, 'm')?.readOnly).toBe('flow');
    expect(d('a: 1\n', 'a')?.flow).toBe(false);
  });

  it('reports the node own anchor', () => {
    const v = d('a: &base\n  x: 1\n', 'a');
    expect(v?.anchor).toBe('base');
    expect(d('a: 1\n', 'a')?.anchor).toBeUndefined();
  });

  it('reports an alias as read-only', () => {
    const v = d('a: &x 1\nb: *x\n', 'b');
    expect(v?.type).toBe('alias');
    expect(v?.readOnly).toBe('alias');
  });

  it('returns undefined for a missing path or document', () => {
    expect(d('a: 1\n', 'nope')).toBeUndefined();
    expect(describeNode(parseText('a: 1\n'), { doc: 3, path: [] })).toBeUndefined();
  });
});
