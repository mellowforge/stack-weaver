import type { SchemaError } from '../formats/types.js';

/**
 * Builds the message for one problem. Schema problems pass the validator's error; the core's own
 * problems pass an error-shaped object whose `keyword` is the table key and whose `params` carry
 * the values named in {@link defaultMessages}.
 */
export type MessageFn = (error: SchemaError) => string;

/**
 * The message table: ajv keywords (`type`, `required`, ...) plus the core's own problem codes
 * (`kind.unknown`, `kind.apiVersion`, `document.mapping`, `format.extraDocument`,
 * `schema.unavailable`, `yaml.data`, `rule.failed`) and the entries of each rule's own `messages`. Pass a partial table to `validateText` to replace entries,
 * for example with translations.
 */
export type SchemaMessages = Record<string, MessageFn>;

function list(v: unknown): string {
  return Array.isArray(v) ? v.map(String).join(', ') : String(v);
}

function types(v: unknown): string[] {
  const out: string[] = [];
  for (const t of Array.isArray(v) ? v : [v]) {
    for (const part of String(t).split(',')) if (!out.includes(part)) out.push(part);
  }
  return out;
}

const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/**
 * The default English messages. Entries for the core's own problems read these `params`:
 * - `kind.unknown`: `kind`;
 * - `kind.apiVersion`: `apiVersion`, `kind`, `expected` (every valid apiVersion);
 * - `document.mapping`: none;
 * - `format.extraDocument`: none;
 * - `schema.unavailable`: `kind` (the kind, or the format's label), `cause`;
 * - `yaml.data`: `cause`;
 * - `rule.failed`: `rule` (the rule's id), `cause`.
 */
export const defaultMessages: SchemaMessages = {
  // `params.type` may hold several types once branch errors are merged: "Must be an integer or string".
  type: (e) => {
    const ts = types(e.params['type']);
    return `Must be ${article(ts[0] ?? '')} ${ts.join(' or ')}`;
  },
  enum: (e) => `Must be one of: ${list(e.params['allowedValues'])}`,
  const: (e) => `Must be “${String(e.params['allowedValue'])}”`,
  minimum: (e) => `Must be ≥ ${String(e.params['limit'])}`,
  maximum: (e) => `Must be ≤ ${String(e.params['limit'])}`,
  exclusiveMinimum: (e) => `Must be > ${String(e.params['limit'])}`,
  exclusiveMaximum: (e) => `Must be < ${String(e.params['limit'])}`,
  multipleOf: (e) => `Must be a multiple of ${String(e.params['multipleOf'])}`,
  pattern: () => 'Has an invalid format',
  format: () => 'Has an invalid format',
  minLength: (e) => `Must be at least ${String(e.params['limit'])} characters`,
  maxLength: (e) => `Must be at most ${String(e.params['limit'])} characters`,
  minItems: (e) => `Must have at least ${String(e.params['limit'])} items`,
  maxItems: (e) => `Must have at most ${String(e.params['limit'])} items`,
  uniqueItems: () => 'Items must be unique',
  minProperties: (e) => `Must have at least ${String(e.params['limit'])} fields`,
  maxProperties: (e) => `Must have at most ${String(e.params['limit'])} fields`,
  required: (e) => `Missing required field “${String(e.params['missingProperty'])}”`,
  additionalProperties: (e) => `Unknown field “${String(e.params['additionalProperty'])}”`,
  unevaluatedProperties: (e) => `Unknown field “${String(e.params['unevaluatedProperty'])}”`,
  anyOf: () => 'Does not match any of the allowed shapes',
  oneOf: () => 'Does not match exactly one of the allowed shapes',
  'kind.unknown': (e) => `Unknown kind “${String(e.params['kind'])}” — edit in code`,
  'kind.apiVersion': (e) =>
    `“${String(e.params['apiVersion'])}” is not a valid apiVersion for ${String(e.params['kind'])}; expected ${list(e.params['expected'])}`,
  'document.mapping': () => 'A document must be a mapping',
  'format.extraDocument': () => 'Compose files contain one document; this one is ignored',
  'schema.unavailable': (e) => `Could not load the schema for ${String(e.params['kind'])}: ${String(e.params['cause'])}`,
  'yaml.data': (e) => `Could not read the document's data: ${String(e.params['cause'])}`,
  'rule.failed': (e) => `The “${String(e.params['rule'])}” check failed to run: ${String(e.params['cause'])}`,
};

/**
 * Message for `error`, from `messages`, then {@link defaultMessages}. A keyword with no entry in
 * either (possible only with a third-party `ValidateFn` that reports its own keywords) falls back
 * to the validator's own text.
 */
export function messageFor(error: SchemaError, messages: Partial<SchemaMessages> = defaultMessages): string {
  const fn = messages[error.keyword] ?? defaultMessages[error.keyword];
  if (fn) return fn(error);
  return error.message ? `Invalid value: ${error.message}` : `Invalid value (${error.keyword})`;
}
