import { isMap, isScalar } from 'yaml';
import { isEmptyDocument } from '../../document/data.js';
import type { ParsedText } from '../../document/types.js';
import { deepFreeze } from '../freeze.js';
import type { FormatDefinition, SchemaBundle } from '../types.js';
import { kubernetesGuide } from './guide.js';
import { kubernetesKinds, loadKubernetesKind } from './loader.js';
import { kubernetesRecipes } from './recipes.js';

function str(doc: ParsedText['docs'][number] | undefined, key: string): string | undefined {
  const node = doc?.get(key, true);
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

/** The Kubernetes format: multi-document resources validated per `apiVersion`/`kind`. */
export const kubernetesFormat: FormatDefinition = deepFreeze<FormatDefinition>({
  id: 'kubernetes',
  label: 'Kubernetes',
  // The Kubernetes release pinned in schema-sources.lock.json ("kubernetes"), without the `v`.
  version: '1.37.2',
  rootModel: 'documents',
  /** True when the text parses, has a non-empty document, and every non-empty document is a mapping with string `apiVersion` and `kind`. */
  detect(p: ParsedText): boolean {
    const docs = p.docs.filter((_, i) => !isEmptyDocument(p, i));
    return (
      p.ok &&
      docs.length > 0 &&
      docs.every((d) => isMap(d.contents) && str(d, 'apiVersion') !== undefined && str(d, 'kind') !== undefined)
    );
  },
  kinds: kubernetesKinds,
  loadSchema(p: ParsedText, doc: number): Promise<SchemaBundle | undefined> {
    const d = p.docs[doc];
    const apiVersion = str(d, 'apiVersion');
    const kind = str(d, 'kind');
    if (apiVersion === undefined || kind === undefined) return Promise.resolve(undefined);
    return loadKubernetesKind(apiVersion, kind);
  },
  guide: kubernetesGuide,
  recipes: kubernetesRecipes,
});
