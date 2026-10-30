import type { SchemaBundle } from '../types.js';
import { cachedLoad, wrapValidator } from '../validator.js';

const cache = new Map<string, Promise<SchemaBundle>>();

/**
 * Lazily loads the pinned compose-spec schema and its precompiled validator. The schema and the
 * validator are separate chunks, loaded in parallel; the result is cached, so repeated calls
 * return the same bundle (a failed load is not cached).
 * @returns The bundle with id `'compose'`.
 */
export function loadComposeSchema(): Promise<SchemaBundle> {
  return cachedLoad(cache, 'compose', async () => {
    const [s, v] = await Promise.all([import('./generated/compose.schema.js'), import('./generated/compose.validate.js')]);
    return wrapValidator('compose', s, v);
  });
}
