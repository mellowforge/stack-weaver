/** The operator of a `${NAME<op>arg}` placeholder. */
export type PlaceholderOp = ':-' | '-' | ':?' | '?' | ':+' | '+';

/** One variable placeholder found in a scalar's string value. */
export interface Placeholder {
  /** The variable name. */
  readonly name: string;
  /** Offset of the placeholder's first character (the `$`) in the string. */
  readonly start: number;
  /** Offset just past the placeholder's last character. */
  readonly end: number;
  /** The operator; absent for `$VAR` and `${VAR}`. */
  readonly op?: PlaceholderOp;
  /** The raw text after the operator; it may itself hold placeholders. */
  readonly arg?: string;
}

const OPS: readonly PlaceholderOp[] = [':-', ':?', ':+', '-', '?', '+'];

const isNameStart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z_]/.test(c);
const isNameChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/** Returns the end offset of the name starting at `from` (`from` when there is none). */
function nameEnd(value: string, from: number): number {
  if (!isNameStart(value[from])) return from;
  let i = from + 1;
  while (isNameChar(value[i])) i++;
  return i;
}

/** Parses a braced placeholder whose `${` is at `start`. Returns undefined when it is malformed. */
function parseBraced(value: string, start: number): Placeholder | undefined {
  const nameFrom = start + 2;
  const nameTo = nameEnd(value, nameFrom);
  if (nameTo === nameFrom) return undefined;
  const name = value.slice(nameFrom, nameTo);
  if (value[nameTo] === '}') return { name, start, end: nameTo + 1 };
  const op = OPS.find((o) => value.startsWith(o, nameTo));
  if (op === undefined) return undefined;
  const argFrom = nameTo + op.length;
  let depth = 1;
  let i = argFrom;
  while (i < value.length) {
    if (value.startsWith('$$', i)) i += 2;
    else if (value.startsWith('${', i)) {
      depth++;
      i += 2;
    } else if (value[i] === '}' && --depth === 0) {
      return { name, start, end: i + 1, op, arg: value.slice(argFrom, i) };
    } else i++;
  }
  return undefined;
}

/**
 * Finds the placeholders in a string, left to right. `$$` is an escaped `$`. A lone `$`, an
 * unterminated `${`, and a `${` followed by an invalid name are literal text and not reported.
 */
export function scanPlaceholders(value: string): readonly Placeholder[] {
  const found: Placeholder[] = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] !== '$') {
      i++;
    } else if (value[i + 1] === '$') {
      i += 2;
    } else if (value[i + 1] === '{') {
      const p = parseBraced(value, i);
      if (p) {
        found.push(p);
        i = p.end;
      } else i++;
    } else {
      const to = nameEnd(value, i + 1);
      if (to > i + 1) {
        found.push({ name: value.slice(i + 1, to), start: i, end: to });
        i = to;
      } else i++;
    }
  }
  return found;
}

/** The variable name when the whole value is exactly one placeholder (with any operator). */
export function referenceOf(value: string): string | undefined {
  const [only, ...rest] = scanPlaceholders(value);
  if (only && rest.length === 0 && only.start === 0 && only.end === value.length) return only.name;
  return undefined;
}
