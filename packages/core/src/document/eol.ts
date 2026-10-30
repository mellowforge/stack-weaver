/**
 * The line ending of `text`: `\r\n` when its first line break is `\r\n`, else `\n` (also when it has
 * no line break).
 * @internal
 */
export function detectEol(text: string): '\n' | '\r\n' {
  const nl = text.indexOf('\n');
  return nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n';
}
