import type { VariableDecl } from '../formats/types.js';

/** What a variable name must look like: a letter or underscore, then letters, digits or underscores. */
export const NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TYPES: readonly string[] = ['string', 'number', 'boolean', 'port', 'enum'];

/**
 * Checks an already-built declaration. Returns the first thing wrong with it, or `undefined`
 * when it is valid: the name, the type, the enum list (required for `enum`, a `badField`
 * for any other type) and the default (which must fit the type).
 */
export function checkDecl(
  d: VariableDecl,
): 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField' | undefined {
  if (typeof d.name !== 'string' || !NAME_PATTERN.test(d.name)) return 'badName';
  if (!TYPES.includes(d.type)) return 'badType';
  if (d.type === 'enum') {
    const list = d.enumValues;
    if (!Array.isArray(list) || list.length === 0 || list.some((v) => typeof v !== 'string')) {
      return 'noEnumValues';
    }
  } else if (d.enumValues !== undefined) return 'badField';
  if (d.description !== undefined && typeof d.description !== 'string') return 'badField';
  const v: unknown = d.default;
  if (v === undefined) return undefined;
  switch (d.type) {
    case 'string':
      return typeof v === 'string' ? undefined : 'badDefault';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? undefined : 'badDefault';
    case 'boolean':
      return typeof v === 'boolean' ? undefined : 'badDefault';
    case 'port':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? undefined : 'badDefault';
    default:
      return typeof v === 'string' && (d.enumValues as readonly string[]).includes(v) ? undefined : 'badDefault';
  }
}
