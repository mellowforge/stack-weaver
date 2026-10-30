import type { SchemaError } from '../formats/types.js';

/** Builds the message for one schema error of a given ajv keyword. */
export type MessageFn = (error: SchemaError) => string;

/** Messages keyed by ajv keyword, so a later plan can swap in translations. */
export type Messages = Record<string, MessageFn>;

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

/** The default English messages. */
export const defaultMessages: Messages = {
  // `params.type` may hold several types once branch errors are merged: "Must be a integer or string".
  type: (e) => `Must be a ${types(e.params.type).join(' or ')}`,
  enum: (e) => `Must be one of: ${list(e.params.allowedValues)}`,
  const: (e) => `Must be “${String(e.params.allowedValue)}”`,
  minimum: (e) => `Must be ≥ ${String(e.params.limit)}`,
  maximum: (e) => `Must be ≤ ${String(e.params.limit)}`,
  exclusiveMinimum: (e) => `Must be > ${String(e.params.limit)}`,
  exclusiveMaximum: (e) => `Must be < ${String(e.params.limit)}`,
  multipleOf: (e) => `Must be a multiple of ${String(e.params.multipleOf)}`,
  pattern: () => 'Has an invalid format',
  format: () => 'Has an invalid format',
  minLength: (e) => `Must be at least ${String(e.params.limit)} characters`,
  maxLength: (e) => `Must be at most ${String(e.params.limit)} characters`,
  minItems: (e) => `Must have at least ${String(e.params.limit)} items`,
  maxItems: (e) => `Must have at most ${String(e.params.limit)} items`,
  uniqueItems: () => 'Items must be unique',
  minProperties: (e) => `Must have at least ${String(e.params.limit)} fields`,
  maxProperties: (e) => `Must have at most ${String(e.params.limit)} fields`,
  required: (e) => `Missing required field “${String(e.params.missingProperty)}”`,
  additionalProperties: (e) => `Unknown field “${String(e.params.additionalProperty)}”`,
  unevaluatedProperties: (e) => `Unknown field “${String(e.params.unevaluatedProperty)}”`,
  anyOf: () => 'Does not match any of the allowed shapes',
  oneOf: () => 'Does not match exactly one of the allowed shapes',
};

/** Message for `error`, falling back to the validator's own text for keywords without an entry. */
export function messageFor(error: SchemaError, messages: Messages = defaultMessages): string {
  const fn = messages[error.keyword];
  if (fn) return fn(error);
  return error.message ? `Invalid value: ${error.message}` : `Invalid value (${error.keyword})`;
}
