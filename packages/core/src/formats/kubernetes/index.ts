import { isMap, isScalar } from 'yaml';
import type { ParsedText } from '../../document/types.js';
import type { FormatDefinition, SchemaBundle } from '../types.js';
import { kubernetesGuide } from './guide.js';
import { kubernetesKinds, loadKubernetesKind } from './loader.js';

export { kubernetesKinds, loadKubernetesKind };
export { kubernetesGuide };

function str(doc: ParsedText['docs'][number] | undefined, key: string): string | undefined {
  const node = doc?.get(key, true);
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}

/** The Kubernetes format: multi-document resources validated per `apiVersion`/`kind`. */
export const kubernetesFormat: FormatDefinition = {
  id: 'kubernetes',
  label: 'Kubernetes',
  version: '1.37.2',
  rootModel: 'documents',
  detect(p: ParsedText): boolean {
    return (
      p.ok &&
      p.docs.length > 0 &&
      p.docs.every((d) => isMap(d.contents) && str(d, 'apiVersion') !== undefined && str(d, 'kind') !== undefined)
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
};
