import type { YamlPath, YamlValue } from '../document/types.js';
import { guideField } from '../formats/guide.js';
import type { Guide, GuideField, SchemaBundle, Tier } from '../formats/types.js';
import { resolveAt, type ResolvedSchema } from './resolve.js';

/** One thing that may be added at a path. */
export interface AddableItem {
  /** Property name, or `null` for a new sequence item. */
  readonly key: string | null;
  /** Display label; defaults to the property name. */
  readonly label: string;
  /** Plain-language description; defaults to the first sentence of the schema description. */
  readonly description: string;
  /** Presentation tier. */
  readonly tier: Tier;
  /** True when the schema requires the property (it is missing, otherwise it would not be listed). */
  readonly required: boolean;
  /** Starting value: the guide example, else an empty value by schema type. */
  readonly valueTemplate: YamlValue;
}

export type { Tier };

const TIER_RANK: Record<Tier, number> = { recommended: 0, common: 1, advanced: 2 };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @internal Shared with the assist engine; not part of the public API. */
export function firstSentence(text: string | undefined): string {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  return m ? m[0] : flat;
}

function template(r: ResolvedSchema | undefined): YamlValue {
  if (!r) return null;
  const s = r.schema;
  const t = s['type'];
  const types = (Array.isArray(t) ? t : typeof t === 'string' ? [t] : []).filter((x) => x !== 'null');
  const type = types[0];
  if (type === 'object') return {};
  if (type === 'array') return [];
  if (type === 'string') return '';
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  const alts = (s['anyOf'] ?? s['oneOf']) as unknown;
  if (Array.isArray(alts) && alts.some((a) => isObj(a) && a['type'] === 'string')) return '';
  if (isObj(s['properties'])) return {};
  if (s['items'] !== undefined) return [];
  return null;
}

function tierOf(g: GuideField | undefined): Tier {
  return g === undefined ? 'advanced' : (g.tier ?? 'common');
}

/**
 * The guide entry for `prop`, found under the resolved definition first, then under the one that declared it.
 * @internal Shared with the assist engine; not part of the public API.
 */
export function fieldHint(guide: Guide, parent: ResolvedSchema, prop: string): GuideField | undefined {
  return guideField(guide, parent.defName, prop) ?? guideField(guide, parent.declaredIn?.[prop], prop);
}

function valueFor(g: GuideField | undefined, child: ResolvedSchema | undefined): YamlValue {
  return g?.example !== undefined ? g.example : template(child);
}

/**
 * The starting value for the node at `path`: the guide `example` of the property at the last path
 * segment when there is one, otherwise an empty value for the schema's type (`{}` for objects,
 * `[]` for arrays, `''` for strings, `0` for numbers, `false` for booleans, `null` when unknown).
 * This is the `valueTemplate` that `addableAt` reports for the same property.
 * @param bundle - Schema bundle for the document.
 * @param guide - Guide overlay supplying examples.
 * @param path - Path of the node to create.
 * @param data - The document as plain data; used to pick `anyOf`/`oneOf` branches.
 * @returns The starting value; `null` when the path does not resolve.
 */
export function valueTemplateAt(bundle: SchemaBundle, guide: Guide, path: YamlPath, data?: unknown): YamlValue {
  const child = resolveAt(bundle, path, data);
  const last = path[path.length - 1];
  if (typeof last !== 'string') return template(child);
  const parent = resolveAt(bundle, path.slice(0, -1), data);
  return valueFor(parent && fieldHint(guide, parent, last), child);
}

/**
 * Lists what may be added at `path`: missing properties of an object, or one new item for a sequence.
 *
 * - A sequence (a schema with `items`) gives a single entry with `key: null`, label `'Item'`,
 *   tier `'common'`, the item schema's first description sentence and a value template for one
 *   item.
 * - An object gives one entry per declared property that is not present yet. Entries are ordered
 *   required-and-missing first, then by tier (recommended, common, advanced), then guide `order`
 *   ascending, then name. Guide-`hidden` keys are excluded; properties without a guide entry count
 *   as advanced.
 * - An object whose keys are free-form (only `additionalProperties` / `patternProperties`, such as
 *   labels or a ConfigMap's `data`) gives `[]`: there is no key to suggest, so callers offer their
 *   own key input.
 *
 * `valueTemplate` is the guide `example` when there is one; otherwise an empty value for the
 * schema's type: `{}` for objects, `[]` for arrays, `''` for strings (also for unions with a string
 * branch, such as int-or-string), `0` for numbers, `false` for booleans, and `null` when the type
 * is unknown.
 * @param bundle - Schema bundle for the document.
 * @param guide - Guide overlay for labels, tiers and examples.
 * @param path - Path of the node to add to.
 * @param data - The document as plain data.
 * @returns The addable items; empty when the path does not resolve or nothing can be added.
 */
export function addableAt(bundle: SchemaBundle, guide: Guide, path: YamlPath, data: unknown): AddableItem[] {
  const resolved = resolveAt(bundle, path, data);
  if (!resolved) return [];
  const schema = resolved.schema;

  const itemsSchema = schema['items'];
  if (isObj(itemsSchema)) {
    const itemResolved = resolveAt(bundle, [...path, 0], data);
    return [
      {
        key: null,
        label: 'Item',
        description: firstSentence(itemResolved?.description ?? resolved.description),
        tier: 'common',
        required: false,
        valueTemplate: template(itemResolved),
      },
    ];
  }

  const props = schema['properties'];
  if (!isObj(props)) return [];
  const node = path.reduce<unknown>((d, seg) => (isObj(d) ? d[seg] : Array.isArray(d) && typeof seg === 'number' ? d[seg] : undefined), data);
  const present = isObj(node) ? node : {};

  const entries: { item: AddableItem; order: number }[] = [];
  for (const prop of Object.keys(props)) {
    if (Object.prototype.hasOwnProperty.call(present, prop)) continue;
    const g = fieldHint(guide, resolved, prop);
    if (g?.hidden) continue;
    const child = resolveAt(bundle, [...path, prop], data);
    entries.push({
      order: g?.order ?? Number.POSITIVE_INFINITY,
      item: {
        key: prop,
        label: g?.label ?? prop,
        description: g?.description ?? firstSentence(child?.description),
        tier: tierOf(g),
        required: resolved.required.includes(prop),
        valueTemplate: valueFor(g, child),
      },
    });
  }

  entries.sort((a, b) => {
    if (a.item.required !== b.item.required) return a.item.required ? -1 : 1;
    const t = TIER_RANK[a.item.tier] - TIER_RANK[b.item.tier];
    if (t !== 0) return t;
    if (a.order !== b.order) return a.order < b.order ? -1 : 1;
    return a.item.key! < b.item.key! ? -1 : a.item.key! > b.item.key! ? 1 : 0;
  });
  return entries.map((e) => e.item);
}
