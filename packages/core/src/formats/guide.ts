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
 * field. A kind that still lacks `label`, `description` or `group` after merging is dropped.
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
  return {
    groups: [...groups.values()].sort((a, b) => a.order - b.order),
    kinds,
    fields: mergeRecords<GuideField>(base.fields, override.fields),
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

/** Looks up the guide entry for `<defName>#<prop>`; `undefined` when `defName` is undefined or no entry exists. */
export function guideField(g: Guide, defName: string | undefined, prop: string): GuideField | undefined {
  if (defName === undefined) return undefined;
  return g.fields[`${defName}#${prop}`];
}
