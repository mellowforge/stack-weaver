import { stringify } from 'yaml';
import type { YamlValue } from '../document/types.js';
import { resolveAt } from '../engine/resolve.js';
import { valueTemplateAt } from '../engine/addable.js';
import type { Guide, KindEntry, SchemaBundle } from '../formats/types.js';

/**
 * The YAML of a new resource of `entry`: `apiVersion`, `kind`, `metadata.name` (the kind in
 * lowercase) and every other property the schema requires at the top level, each with its starting
 * value from {@link valueTemplateAt}. Required properties with an empty template are placeholders
 * the user fills in.
 * @param entry - The kind to create.
 * @param bundle - The kind's loaded schema bundle.
 * @param guide - The guide supplying examples.
 * @param eol - The line ending of the text the document is added to.
 * @returns The document, ending with a line break and using `eol` throughout.
 * @internal
 */
export function skeletonFor(entry: KindEntry, bundle: SchemaBundle, guide: Guide, eol: '\n' | '\r\n'): string {
  const doc: Record<string, YamlValue> = {
    apiVersion: entry.apiVersion,
    kind: entry.kind,
    metadata: { name: entry.kind.toLowerCase() },
  };
  const required = resolveAt(bundle, [], doc)?.required ?? [];
  for (const prop of required) {
    if (prop in doc) continue;
    doc[prop] = valueTemplateAt(bundle, guide, [prop], doc);
  }
  return stringify(doc).replace(/\n/g, eol);
}
