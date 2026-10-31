import type { YamlPath } from '../../../document/types.js';
import type { VariableDecl } from '../../types.js';
import { referenceOf, scanPlaceholders } from './syntax.js';

/** Converts default text to the declared type; text that does not fit the type stays a string. */
function coerce(text: string, decl: VariableDecl | undefined): unknown {
  switch (decl?.type) {
    case 'number':
    case 'port': {
      const n = Number(text);
      return text.trim() !== '' && Number.isFinite(n) ? n : text;
    }
    case 'boolean':
      return text === 'true' ? true : text === 'false' ? false : text;
    default:
      return text;
  }
}

/**
 * The text a placeholder stands for, or undefined when it has no usable default. An inline
 * default (`:-`, `-`) wins over the declared one; `:?` and `?` fall back to the declared default;
 * `:+` and `+` never have a default.
 */
function defaultText(
  op: string | undefined,
  arg: string | undefined,
  decl: VariableDecl | undefined,
  decls: ReadonlyMap<string, VariableDecl>,
): string | undefined {
  if (op === ':+' || op === '+') return undefined;
  if ((op === ':-' || op === '-') && arg !== undefined) {
    const inner = substituteValue(arg, decls);
    return inner.typeOnly ? undefined : String(inner.value);
  }
  return decl?.default === undefined ? undefined : String(decl.default);
}

/**
 * Substitutes the placeholders of one string with their defaults. A string that is one whole
 * placeholder takes the declared type of the variable; placeholders inside longer text become
 * text. When any placeholder has no usable default the original string is returned with
 * `typeOnly` set: the value is only known by type, so value checks on it must be skipped.
 */
export function substituteValue(
  value: string,
  decls: ReadonlyMap<string, VariableDecl>,
): { value: unknown; typeOnly: boolean } {
  const found = scanPlaceholders(value);
  if (found.length === 0) return { value, typeOnly: false };
  const texts: string[] = [];
  for (const p of found) {
    const text = defaultText(p.op, p.arg, decls.get(p.name), decls);
    if (text === undefined) return { value, typeOnly: true };
    texts.push(text);
  }
  const ref = referenceOf(value);
  if (ref !== undefined) return { value: coerce(texts[0] as string, decls.get(ref)), typeOnly: false };
  let out = '';
  let at = 0;
  found.forEach((p, i) => {
    out += value.slice(at, p.start) + texts[i];
    at = p.end;
  });
  return { value: out + value.slice(at), typeOnly: false };
}

/**
 * Substitutes every string scalar of `data` with {@link substituteValue}, returning new
 * containers and leaving `data` untouched. The root key `skipKey` (the declaration block) is
 * copied as is. `skip` lists the paths of scalars that are only known by type.
 */
export function substituteData(
  data: unknown,
  decls: readonly VariableDecl[],
  skipKey: string,
): { data: unknown; skip: YamlPath[] } {
  const byName = new Map(decls.map((d) => [d.name, d]));
  const skip: YamlPath[] = [];
  const walk = (node: unknown, path: YamlPath): unknown => {
    if (typeof node === 'string') {
      const r = substituteValue(node, byName);
      if (r.typeOnly) skip.push(path);
      return r.value;
    }
    if (Array.isArray(node)) return node.map((item, i) => walk(item, [...path, i]));
    if (node !== null && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = path.length === 0 && k === skipKey ? v : walk(v, [...path, k]);
      }
      return out;
    }
    return node;
  };
  return { data: walk(data, []), skip };
}
