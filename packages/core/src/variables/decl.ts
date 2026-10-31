/** What a variable name must look like: a letter or underscore, then letters, digits or underscores. */
export const NAME_PATTERN: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The variable types, in the order the Variables section lists them. */
export const VARIABLE_TYPES = ['string', 'number', 'boolean', 'port', 'enum'] as const;

/** What is wrong with a variable declaration (see {@link validateVariableDecl}). */
export type VariableDeclIssue = 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField';

const KEYS: readonly string[] = ['name', 'type', 'enumValues', 'default', 'description'];

/**
 * Checks a declaration of any origin (a host's list, a form, parsed data) and returns the first
 * thing wrong with it, or `undefined` when it is a valid `VariableDecl`. In this order:
 *
 * - `'badField'`: the value is not an object.
 * - `'badName'`: `name` is missing or does not match `NAME_PATTERN`.
 * - `'badType'`: `type` is missing or not one of `VARIABLE_TYPES`.
 * - `'badField'`: a key other than `name`, `type`, `enumValues`, `default` and `description`;
 *   `enumValues` on a type other than `'enum'`; a `description` that is not text.
 * - `'noEnumValues'`: an `'enum'` whose `enumValues` is not a non-empty list of strings.
 * - `'badDefault'`: `default` does not fit the type (a finite number; an integer from 1 to 65535 for
 *   `'port'`; one of `enumValues` for `'enum'`).
 */
export function validateVariableDecl(value: unknown): VariableDeclIssue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'badField';
  const d = value as Record<string, unknown>;
  if (typeof d['name'] !== 'string' || !NAME_PATTERN.test(d['name'])) return 'badName';
  const type = d['type'];
  if (!VARIABLE_TYPES.some((t) => t === type)) return 'badType';
  if (Object.keys(d).some((k) => !KEYS.includes(k))) return 'badField';
  const list = d['enumValues'];
  if (type === 'enum') {
    if (!Array.isArray(list) || list.length === 0 || list.some((v) => typeof v !== 'string')) return 'noEnumValues';
  } else if (list !== undefined) return 'badField';
  if (d['description'] !== undefined && typeof d['description'] !== 'string') return 'badField';
  const v = d['default'];
  if (v === undefined) return undefined;
  switch (type) {
    case 'string':
      return typeof v === 'string' ? undefined : 'badDefault';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? undefined : 'badDefault';
    case 'boolean':
      return typeof v === 'boolean' ? undefined : 'badDefault';
    case 'port':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535 ? undefined : 'badDefault';
    default:
      return typeof v === 'string' && (list as readonly string[]).includes(v) ? undefined : 'badDefault';
  }
}
