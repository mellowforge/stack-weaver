import { deepFreeze } from '../freeze.js';
import type { DetectInput, FormatDefinition, SchemaBundle } from '../types.js';
import { kubernetesGuide } from './guide.js';
import { kubernetesKinds, loadKubernetesKind } from './loader.js';
import { kubernetesRecipes } from './recipes.js';
import { kubernetesRules } from './rules.js';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function str(data: unknown, key: string): string | undefined {
  const v = isRecord(data) ? data[key] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** The Kubernetes format: multi-document resources validated per `apiVersion`/`kind`. */
export const kubernetesFormat: FormatDefinition = deepFreeze<FormatDefinition>({
  id: 'kubernetes',
  label: 'Kubernetes',
  // The Kubernetes release pinned in schema-sources.lock.json ("kubernetes"), without the `v`.
  version: '1.37.2',
  rootModel: 'documents',
  /** True when the text parses, has a non-empty document, and every non-empty document is a mapping with string `apiVersion` and `kind`. */
  detect(input: DetectInput): boolean {
    const docs = input.docs.filter((d) => d !== undefined);
    return docs.length > 0 && docs.every((d) => isRecord(d) && str(d, 'apiVersion') !== undefined && str(d, 'kind') !== undefined);
  },
  kinds: kubernetesKinds,
  loadSchema(data: unknown): Promise<SchemaBundle | undefined> {
    const apiVersion = str(data, 'apiVersion');
    const kind = str(data, 'kind');
    if (apiVersion === undefined || kind === undefined) return Promise.resolve(undefined);
    return loadKubernetesKind(apiVersion, kind);
  },
  guide: kubernetesGuide,
  recipes: kubernetesRecipes,
  rules: kubernetesRules,
});
