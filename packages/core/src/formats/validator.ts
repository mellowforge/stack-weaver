import type { SchemaBundle, SchemaError } from './types.js';

/** The generated schema chunk: the JSON Schema root. */
export interface SchemaModule {
  schema: Record<string, unknown>;
}

/** The generated validator chunk: the precompiled ajv validator. */
export interface ValidateModule {
  validate: ((data: unknown) => boolean) & { errors?: unknown[] | null };
}

/**
 * Wraps a generated schema and precompiled ajv validator pair into a {@link SchemaBundle}.
 * The validator returns plain {@link SchemaError} copies, since the standalone function reuses its
 * `errors` array on every call.
 * @param id - Bundle identifier.
 * @param s - The generated schema module.
 * @param v - The generated validator module.
 */
export function wrapValidator(id: string, s: SchemaModule, v: ValidateModule): SchemaBundle {
  const fn = v.validate;
  return {
    id,
    schema: s.schema,
    validate(data) {
      if (fn(data)) return [];
      return ((fn.errors ?? []) as SchemaError[]).map(({ instancePath, keyword, params, message }) =>
        message === undefined ? { instancePath, keyword, params } : { instancePath, keyword, params, message },
      );
    },
  };
}

/**
 * Returns `cache`'s promise for `key`, creating it with `load` on a miss. A rejected load is
 * evicted so a later call retries.
 * @param cache - Per-loader promise cache.
 * @param key - Cache key.
 * @param load - Starts the load on a cache miss.
 */
export function cachedLoad<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    p.catch(() => cache.delete(key)); // a failed chunk load may be retried
    cache.set(key, p);
  }
  return p;
}
