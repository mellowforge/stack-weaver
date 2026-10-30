import { describe, expect, it } from 'vitest';
import { diffText } from '../../src/document/diff.js';

const apply = (a: string, c: { from: number; to: number; insert: string }): string =>
  a.slice(0, c.from) + c.insert + a.slice(c.to);

describe('diffText', () => {
  it('returns an empty change for equal texts', () => {
    expect(diffText('abc', 'abc')).toEqual({ from: 3, to: 3, insert: '' });
  });

  it('finds a single replacement between common prefix and suffix', () => {
    expect(diffText('image: a:1\nx', 'image: a:22\nx')).toEqual({ from: 9, to: 10, insert: '22' });
  });

  it('handles pure insertions and deletions', () => {
    expect(diffText('ab', 'aXb')).toEqual({ from: 1, to: 1, insert: 'X' });
    expect(diffText('aXb', 'ab')).toEqual({ from: 1, to: 2, insert: '' });
  });

  it('does not double-count overlapping prefix and suffix', () => {
    const c = diffText('aa', 'aaa');
    expect(apply('aa', c)).toBe('aaa');
    expect(c.to - c.from).toBe(0);
    expect(apply('aaa', diffText('aaa', 'aa'))).toBe('aa');
  });

  it('never splits a surrogate pair', () => {
    const c = diffText('x🚀y', 'x🎉y');
    expect(c).toEqual({ from: 1, to: 3, insert: '🎉' });
  });

  it('round-trips arbitrary edits', () => {
    const pairs: [string, string][] = [
      ['', 'abc'],
      ['abc', ''],
      ['a\r\nb', 'a\r\nc\r\nb'],
      ['こんにちは', 'こんばんは'],
    ];
    for (const [a, b] of pairs) expect(apply(a, diffText(a, b))).toBe(b);
  });
});
