import type { FormatDefinition, KindEntry } from '../formats/types.js';

/** One intent group of the "Add resource" picker. */
export interface CatalogGroup {
  /** The guide group's id, e.g. `'run'`. */
  id: string;
  /** The guide group's display label, e.g. `'Run your app'`. */
  label: string;
  /** Curated kinds in the group, with the guide's plain-language label and description. */
  kinds: (KindEntry & { label: string; description: string })[];
}

/**
 * Builds the "Add resource" catalog for a format.
 * @param format - The format whose kinds and guide are used.
 * @returns `curated`: guide groups in `order`, each with its guide-listed kinds in `order` (groups
 * without any known kind are omitted); `all`: every kind the format knows, curated or not.
 */
export function kindCatalog(format: FormatDefinition): { curated: CatalogGroup[]; all: KindEntry[] } {
  const all = [...format.kinds()];
  const byKey = new Map(all.map((k) => [`${k.apiVersion}/${k.kind}`, k]));
  const curated: CatalogGroup[] = [];
  for (const group of [...format.guide.groups].sort((a, b) => a.order - b.order)) {
    const kinds = Object.entries(format.guide.kinds)
      .filter(([, v]) => v.group === group.id)
      .sort(([ka, a], [kb, b]) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY) || ka.localeCompare(kb))
      .flatMap(([key, v]) => {
        const entry = byKey.get(key);
        return entry ? [{ ...entry, label: v.label, description: v.description }] : [];
      });
    if (kinds.length > 0) curated.push({ id: group.id, label: group.label, kinds });
  }
  return { curated, all };
}
