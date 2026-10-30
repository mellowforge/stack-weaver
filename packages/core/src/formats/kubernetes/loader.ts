import type { KindEntry, SchemaBundle, SchemaError } from '../types.js';
import kinds from './generated/kinds.json' with { type: 'json' };
import { loaders, type SchemaModule, type ValidateModule } from './generated/loaders.js';

const entries: readonly KindEntry[] = Object.freeze(kinds as KindEntry[]);
const idByApiVersionKind = new Map(entries.map((k) => [`${k.apiVersion}/${k.kind}`, k.id]));
const cache = new Map<string, Promise<SchemaBundle | undefined>>();

/**
 * Every Kubernetes kind with a generated schema (GA group-versions of the pinned Kubernetes
 * release; `*List` kinds and `meta` types excluded), sorted by id.
 */
export function kubernetesKinds(): readonly KindEntry[] {
  return entries;
}

/**
 * Lazily loads the schema and precompiled validator for one Kubernetes kind. Each kind has two
 * chunks (schema and validator), loaded in parallel; the result is cached per kind, so repeated
 * calls return the same bundle.
 * @param apiVersion - e.g. `"apps/v1"` or `"v1"`.
 * @param kind - e.g. `"Deployment"`.
 * @returns The bundle, or `undefined` when the kind is not a known built-in kind.
 */
export function loadKubernetesKind(apiVersion: string, kind: string): Promise<SchemaBundle | undefined> {
  const id = idByApiVersionKind.get(`${apiVersion}/${kind}`);
  const load = id === undefined ? undefined : loaders[id];
  if (id === undefined || load === undefined) return Promise.resolve(undefined);
  let bundle = cache.get(id);
  if (!bundle) {
    bundle = load().then(([s, v]) => toBundle(id, s, v));
    bundle.catch(() => cache.delete(id)); // a failed chunk load may be retried
    cache.set(id, bundle);
  }
  return bundle;
}

function toBundle(id: string, s: SchemaModule, v: ValidateModule): SchemaBundle {
  const fn = v.validate;
  return {
    id,
    schema: s.schema,
    validate(data) {
      if (fn(data)) return [];
      // The standalone validator reuses `errors` per call: copy before returning.
      return ((fn.errors ?? []) as SchemaError[]).map(({ instancePath, keyword, params, message }) =>
        message === undefined ? { instancePath, keyword, params } : { instancePath, keyword, params, message },
      );
    },
  };
}
