import { Document, Scalar, parse, stringify, visit } from 'yaml';
import type { ScalarValue } from './edit.js';

const OPTIONS = { indent: 2, lineWidth: 0 } as const;

/**
 * True when a plain (unquoted) rendering of `s` would not read back as the same string in a
 * YAML 1.1 parser. Kubernetes and compose tooling parse YAML 1.1, where `yes`, `on`, `0777` or
 * `2001-12-14` are not strings, so such values are quoted even though YAML 1.2 would not need it.
 */
function retypesIn11(s: string): boolean {
  if (s.includes('\n')) return false;
  try {
    return parse(s, { version: '1.1', logLevel: 'silent' }) !== s;
  } catch {
    return true;
  }
}

const isQuoted = (out: string): boolean => out.startsWith('"') || out.startsWith("'");

/**
 * Renders `value` as YAML for splicing into existing text. The first line carries no indentation,
 * because the caller places it (after `key: `, after `- `, or on a fresh line it has indented);
 * every following line is prefixed with `indent` spaces. Nested levels use 2 spaces, lines are
 * never folded, lines are joined with `eol` and there is no trailing line ending. Strings are
 * quoted when a YAML 1.2 or YAML 1.1 parser would read the plain form as another type.
 *
 * @param value - Any JSON-like value (also `Map`); collections render in block style.
 * @param indent - Column of the continuation lines.
 * @param eol - Line ending of the target text.
 * @returns The rendered YAML.
 */
export function renderValue(value: unknown, indent: number, eol: '\n' | '\r\n'): string {
  const doc = new Document(value);
  visit(doc, {
    Scalar(_, n) {
      if (typeof n.value === 'string' && retypesIn11(n.value)) n.type = Scalar.QUOTE_DOUBLE;
    },
  });
  const pad = ' '.repeat(indent);
  return doc
    .toString(OPTIONS)
    .replace(/\n$/, '')
    .split('\n')
    .map((line, i) => (i === 0 || line === '' ? line : pad + line))
    .join(eol);
}

/**
 * Renders a scalar as a single-line token for replacing a scalar's source range.
 *
 * Strings keep `quote` (the original quote style) when given, and always use double quotes when
 * they contain a line break. A plain result is double-quoted when YAML 1.1 would re-type it, and,
 * inside a flow collection, when it contains `,` `[` `]` `{` `}` `:` `#` or leading or trailing
 * whitespace.
 *
 * @param value - The new scalar value.
 * @param opts - `flow`: the scalar sits inside a flow collection; `quote`: style to keep.
 * @returns The scalar source, without a line ending.
 */
export function renderScalar(
  value: ScalarValue,
  opts: { flow?: boolean; quote?: Scalar.Type | undefined } = {},
): string {
  const node = new Scalar(value);
  const str = (): string => stringify(node, { ...OPTIONS, blockQuote: false }).replace(/\n$/, '');
  if (typeof value !== 'string') return str();
  if (/[\r\n]/.test(value)) node.type = Scalar.QUOTE_DOUBLE;
  else if (opts.quote === Scalar.QUOTE_DOUBLE || opts.quote === Scalar.QUOTE_SINGLE) {
    node.type = opts.quote;
  }
  const out = str();
  if (isQuoted(out)) return out;
  const flowUnsafe = opts.flow === true && /[,[\]{}:#]|^\s|\s$/.test(out);
  if (!flowUnsafe && !retypesIn11(value)) return out;
  node.type = Scalar.QUOTE_DOUBLE;
  return str();
}

/**
 * Renders a string as a block scalar: a header line (`|` or `>`, a chomping indicator chosen to
 * reproduce the value's trailing line breaks, then `headerRest`), followed by the content lines at
 * `indent`. Folded style is kept only for single-line values; anything else becomes literal.
 *
 * @param value - The string value.
 * @param folded - True when the original scalar was folded (`>`).
 * @param headerRest - Text after the original indicators, such as ` # comment`.
 * @param indent - Column of the content lines.
 * @param eol - Line ending of the target text.
 * @returns Header and content joined by `eol` without a trailing line ending, or `undefined`
 *   when the value would need an explicit indentation indicator or contains a carriage return.
 */
export function renderBlockScalar(
  value: string,
  folded: boolean,
  headerRest: string,
  indent: number,
  eol: '\n' | '\r\n',
): string | undefined {
  const body = value.replace(/\n+$/, '');
  const trailing = value.length - body.length;
  if (value.includes('\r') || (body === '' && trailing > 0)) return undefined;
  const lines = body === '' ? [] : body.split('\n');
  const first = lines.find((l) => l !== '');
  if (first !== undefined && /^[ \t]/.test(first)) return undefined;
  for (let i = 1; i < trailing; i++) lines.push('');
  const chomp = trailing === 0 ? '-' : trailing === 1 ? '' : '+';
  const style = folded && lines.length === 1 ? '>' : '|';
  const pad = ' '.repeat(indent);
  return [`${style}${chomp}${headerRest}`, ...lines.map((l) => (l ? pad + l : ''))].join(eol);
}
