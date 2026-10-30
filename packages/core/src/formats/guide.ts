import type { Guide, GuideField } from './types.js';

function mergeRecords<T extends object>(
  base: Record<string, T>,
  override: Record<string, Partial<T>> | undefined,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(base)) out[k] = { ...v };
  for (const [k, v] of Object.entries(override ?? {})) out[k] = { ...out[k], ...v } as T;
  return out;
}

/**
 * Merges a guide override onto a base guide without mutating either.
 * Groups merge by `id` and are sorted by `order`; `kinds` and `fields` merge per key, field by field.
 */
export function mergeGuide(base: Guide, override: Partial<Guide>): Guide {
  const groups = new Map(base.groups.map((g) => [g.id, { ...g }]));
  for (const g of override.groups ?? []) groups.set(g.id, { ...groups.get(g.id), ...g });
  return {
    groups: [...groups.values()].sort((a, b) => a.order - b.order),
    kinds: mergeRecords(base.kinds, override.kinds),
    fields: mergeRecords(base.fields, override.fields),
  };
}

/** Looks up the guide entry for `<defName>#<prop>`; `undefined` when `defName` is undefined or no entry exists. */
export function guideField(g: Guide, defName: string | undefined, prop: string): GuideField | undefined {
  if (defName === undefined) return undefined;
  return g.fields[`${defName}#${prop}`];
}
