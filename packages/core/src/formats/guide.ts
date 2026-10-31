import type { Guide, GuideField, GuideGroup, GuideKind, GuideOverride } from './types.js';

/**
 * The one key used by the guide `kinds` and by `kindCatalog`: `<apiVersion>/<kind>`, such as
 * `apps/v1/Deployment` or `v1/Service`.
 * @param apiVersion - The `apiVersion` written in documents.
 * @param kind - The `kind` written in documents.
 */
export function kindKey(apiVersion: string, kind: string): string {
  return `${apiVersion}/${kind}`;
}

function mergeRecords<T extends object>(
  base: Readonly<Record<string, T>>,
  override: Readonly<Record<string, Partial<T>>> | undefined,
): Record<string, Partial<T>> {
  const out: Record<string, Partial<T>> = {};
  for (const [k, v] of Object.entries(base)) out[k] = { ...v };
  for (const [k, v] of Object.entries(override ?? {})) out[k] = { ...out[k], ...v };
  return out;
}

function isCompleteKind(k: Partial<GuideKind>): k is GuideKind {
  return k.label !== undefined && k.description !== undefined && k.group !== undefined;
}

/**
 * Merges a guide override onto a base guide without mutating either; the base may be frozen and
 * the result is a new, unfrozen object.
 * Groups merge by `id` and are sorted by `order`; `kinds` and `fields` merge per key, field by
 * field. `labelKeys` and `resourceLabel` are replaced whole by an override; `references` merge per kind (an
 * override entry replaces that kind's entry). A kind that still lacks `label`, `description` or `group` after
 * merging is dropped.
 * @param base - The guide to start from.
 * @param override - The partial guide to apply on top.
 */
export function mergeGuide(base: Guide, override: GuideOverride): Guide {
  const groups = new Map<string, GuideGroup>(base.groups.map((g) => [g.id, { ...g }]));
  for (const g of override.groups ?? []) groups.set(g.id, { ...groups.get(g.id), ...g });
  const kinds: Record<string, GuideKind> = {};
  for (const [k, v] of Object.entries(mergeRecords<GuideKind>(base.kinds, override.kinds))) {
    if (isCompleteKind(v)) kinds[k] = v;
  }
  const labelKeys = override.labelKeys ?? base.labelKeys;
  const resourceLabel = override.resourceLabel ?? base.resourceLabel;
  const references = base.references || override.references ? { ...base.references, ...override.references } : undefined;
  return {
    groups: [...groups.values()].sort((a, b) => a.order - b.order),
    kinds,
    fields: mergeRecords<GuideField>(base.fields, override.fields),
    ...(labelKeys && { labelKeys }),
    ...(resourceLabel && { resourceLabel }),
    ...(references && { references }),
  };
}

/**
 * The guide entry of property `key` of the schema node `parent` resolved to: looked up under the
 * definition that declared the property, else under the node's own definition.
 * @param g - The guide.
 * @param parent - The resolved schema of the object that holds `key`.
 * @param key - The property name.
 */
export function guideFieldOf(
  g: Guide,
  parent: { readonly defName?: string; readonly declaredIn?: Readonly<Record<string, string>> } | undefined,
  key: string,
): GuideField | undefined {
  return guideField(g, parent?.declaredIn?.[key] ?? parent?.defName, key);
}

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

/**
 * The label of a sequence item: the first non-empty string among the guide's `labelKeys` of `item`.
 * @param g - The guide.
 * @param item - The item as data.
 * @returns The label, or `undefined` when the item is not a mapping or none of the keys holds a string.
 * @internal
 */
export function itemLabelOf(g: Pick<Guide, 'labelKeys'>, item: unknown): string | undefined {
  const rec = asRecord(item);
  if (!rec) return undefined;
  for (const key of g.labelKeys ?? []) {
    const v = rec[key];
    if (typeof v === 'string' && v !== '') return v;
  }
  return undefined;
}

/**
 * The label of a document: the non-empty string at the guide's `resourceLabel` path.
 * @param g - The guide, or just its `resourceLabel`.
 * @param data - The document as data.
 * @returns The label, or `undefined` when the guide has no path or nothing readable sits there.
 * @internal
 */
export function resourceNameOf(g: Pick<Guide, 'resourceLabel'>, data: unknown): string | undefined {
  if (!g.resourceLabel || g.resourceLabel.length === 0) return undefined;
  let cur: unknown = data;
  for (const seg of g.resourceLabel) {
    cur = typeof seg === 'number' ? (Array.isArray(cur) ? (cur as unknown[])[seg] : undefined) : asRecord(cur)?.[seg];
  }
  return typeof cur === 'string' && cur !== '' ? cur : undefined;
}

/** Looks up the guide entry for `<defName>#<prop>`; `undefined` when `defName` is undefined or no entry exists. */
export function guideField(g: Guide, defName: string | undefined, prop: string): GuideField | undefined {
  if (defName === undefined) return undefined;
  return g.fields[`${defName}#${prop}`];
}
