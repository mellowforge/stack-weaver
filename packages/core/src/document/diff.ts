import type { TextChange } from './types.js';

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/**
 * Computes the single change that turns `a` into `b`: everything between their common prefix and
 * common suffix. The prefix and suffix never overlap, and neither boundary splits a UTF-16
 * surrogate pair.
 *
 * @param a - The text before.
 * @param b - The text after.
 * @returns A change with offsets into `a` and the replacement taken from `b`.
 */
export function diffText(a: string, b: string): TextChange {
  const max = Math.min(a.length, b.length);
  let pre = 0;
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++;
  if (pre > 0 && pre < max && isHigh(a.charCodeAt(pre - 1))) pre--;

  let suf = 0;
  while (
    suf < max - pre &&
    a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)
  )
    suf++;
  if (suf > 0 && isLow(a.charCodeAt(a.length - suf))) suf--;

  return { from: pre, to: a.length - suf, insert: b.slice(pre, b.length - suf) };
}
