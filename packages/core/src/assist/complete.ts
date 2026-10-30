import { addableAt, type AddableItem } from '../engine/addable.js';
import { resolveAt } from '../engine/resolve.js';
import { guideField } from '../formats/guide.js';
import type { Guide, KindEntry, SchemaBundle, Tier } from '../formats/types.js';
import type { CursorContext } from './context.js';

/** One completion for the code editor. */
export interface CodeCompletion {
  /** Text shown and matched against what the user typed. */
  readonly label: string;
  /** Text that replaces `[ctx.from, cursor)` when the completion is accepted. */
  readonly apply: string;
  /** Short note next to the label, such as `required`. */
  readonly detail?: string;
  /** Plain-language description for the completion's info panel. */
  readonly info?: string;
  /** Group heading and its sort rank (0 first). */
  readonly section?: { readonly name: string; readonly rank: number };
  /** Ranking boost; higher sorts earlier. */
  readonly boost?: number;
}

/** Everything {@link completionsFor} needs; plain data, so no editor is involved. */
export interface CompletionInput {
  /** Where the cursor is, from {@link cursorContext}. */
  readonly ctx: CursorContext;
  /** The line break used in the text; inserted after `key:` for nested values. */
  readonly eol: '\n' | '\r\n';
  /** Schema of the document's kind, when known. */
  readonly bundle: SchemaBundle | undefined;
  /** Guide overlay for labels, tiers and examples. */
  readonly guide: Guide;
  /** The document's data from the latest good parse (`toData`); keys already present are not offered. */
  readonly data: unknown;
  /** The format's kinds (`[]` for compose); used for `kind` and `apiVersion` values. */
  readonly kinds: readonly KindEntry[];
  /** Section names per tier. */
  readonly tierLabels: Readonly<Record<Tier, string>>;
}

const TIER_RANK: Record<Tier, number> = { recommended: 0, common: 1, advanced: 2 };
const REQUIRED_BOOST = 10;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The text to insert for a key: `key: ` for scalars, `key:` plus a nested line for objects and arrays. */
function applyKey(item: AddableItem & { key: string }, ctx: CursorContext, eol: string): string {
  const t = item.valueTemplate;
  if (Array.isArray(t)) return `${item.key}:${eol}${' '.repeat(ctx.indent)}- `;
  if (isObj(t)) return `${item.key}:${eol}${' '.repeat(ctx.indent + 2)}`;
  return `${item.key}: `;
}

function keyCompletions(input: CompletionInput): CodeCompletion[] {
  const { ctx, bundle, guide, data, eol, tierLabels } = input;
  if (!bundle) return rootKeysWithoutBundle(input);
  const out: CodeCompletion[] = [];
  for (const item of addableAt(bundle, guide, ctx.path, data)) {
    if (item.key === null) continue;
    const keyed = item as AddableItem & { key: string };
    const detail = item.required ? 'required' : item.label !== item.key ? item.label : undefined;
    out.push({
      label: item.key,
      apply: applyKey(keyed, ctx, eol),
      ...(detail !== undefined && { detail }),
      ...(item.description !== '' && { info: item.description }),
      section: { name: tierLabels[item.tier], rank: TIER_RANK[item.tier] },
      ...(item.required && { boost: REQUIRED_BOOST }),
    });
  }
  return out;
}

/** Before the kind is known there is no schema; at a root the only help is `apiVersion` and `kind`. */
function rootKeysWithoutBundle({ ctx, data, kinds }: CompletionInput): CodeCompletion[] {
  if (ctx.path.length > 0 || kinds.length === 0) return [];
  const present = isObj(data) ? data : {};
  return ['apiVersion', 'kind']
    .filter((k) => !Object.prototype.hasOwnProperty.call(present, k))
    .map((k) => ({ label: k, apply: `${k}: `, boost: REQUIRED_BOOST, detail: 'required' }));
}

function plain(values: Iterable<string>): CodeCompletion[] {
  return [...new Set(values)].map((v) => ({ label: v, apply: v }));
}

/** `kind` and `apiVersion` values at a document root, from the format's kinds. */
function rootValueCompletions(key: string, data: unknown, kinds: readonly KindEntry[]): CodeCompletion[] | undefined {
  if (key === 'kind') return plain(kinds.map((k) => k.kind));
  if (key !== 'apiVersion') return undefined;
  const kind = isObj(data) ? data['kind'] : undefined;
  const forKind = typeof kind === 'string' ? kinds.filter((k) => k.kind === kind) : [];
  return plain((forKind.length > 0 ? forKind : kinds).map((k) => k.apiVersion));
}

function valueCompletions(input: CompletionInput): CodeCompletion[] {
  const { ctx, bundle, data, kinds } = input;
  const key = ctx.key;
  if (key === undefined) return [];
  if (ctx.path.length === 0 && kinds.length > 0) {
    const forRoot = rootValueCompletions(key, data, kinds);
    if (forRoot) return forRoot;
  }
  if (!bundle) return [];
  const schema = resolveAt(bundle, [...ctx.path, key], data)?.schema;
  if (!schema) return [];
  const options = schema['enum'];
  if (Array.isArray(options)) return plain(options.filter((o) => o !== null && typeof o !== 'object').map(String));
  const type = schema['type'];
  if (type === 'string' || (Array.isArray(type) && type.includes('string'))) {
    const parent = resolveAt(bundle, ctx.path, data);
    const suggested = guideField(input.guide, parent?.declaredIn?.[key] ?? parent?.defName, key)?.options;
    if (suggested && suggested.length > 0) return plain(suggested);
  }
  if (schema['type'] === 'boolean') return plain(['true', 'false']);
  return [];
}

/**
 * Completions at the cursor: missing keys for a key position, values for a value position.
 *
 * - **Keys** come from the schema through `addableAt`, so keys already in `data` are left out.
 *   Each carries its tier as a section (`tierLabels[tier]`, rank 0 recommended, 1 common, 2
 *   advanced), the guide label as `detail` (`'required'` for required keys, which also get boost
 *   10), and its description as `info`. `apply` is `key: ` for scalars, `key:` plus a line
 *   indented two more columns for objects, and `key:` plus a `- ` line at the same column for
 *   arrays.
 * - **Values** are offered for plain `enum` schemas, for fields whose guide entry has `options`
 *   (suggested values for closed sets the schema only describes in prose, such as
 *   `imagePullPolicy`), and for `boolean`; `anyOf` schemas such as int-or-string and quantity
 *   give none. `options` are offered for string fields only: the items of a string list have no
 *   key to look up. At a document root `kind` lists the format's kinds and `apiVersion` lists the versions of the kind already written (all versions when there is none).
 * - Without a `bundle` only `apiVersion` and `kind` keys are offered, and only at a root.
 *
 * @param input - Cursor context, schema, guide, data and labels.
 * @returns The completions, unfiltered by prefix (the editor filters); empty when nothing applies.
 */
export function completionsFor(input: CompletionInput): readonly CodeCompletion[] {
  return input.ctx.position === 'key' ? keyCompletions(input) : valueCompletions(input);
}
