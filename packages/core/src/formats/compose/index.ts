import { isMap } from 'yaml';
import type { ParsedText } from '../../document/types.js';
import type { FormatDefinition, SchemaBundle } from '../types.js';
import { composeGuide } from './guide.js';
import { loadComposeSchema } from './loader.js';

export { loadComposeSchema };
export { composeGuide };

const TOP_LEVEL_KEYS = ['services', 'networks', 'volumes', 'configs', 'secrets', 'include'];

/** The Docker Compose format: a single root mapping validated against the compose-spec schema. */
export const composeFormat: FormatDefinition = {
  id: 'compose',
  label: 'Docker Compose',
  // First 7 characters of the pinned compose-spec commit 3a4a6995e4a971f6173dff9130cb3e38e6738651.
  version: '3a4a699',
  rootModel: 'mapping',
  detect(p: ParsedText): boolean {
    if (!p.ok || p.docs.length !== 1) return false;
    const root = p.docs[0]?.contents;
    if (!isMap(root)) return false;
    return !root.has('apiVersion') && TOP_LEVEL_KEYS.some((k) => root.has(k));
  },
  kinds: () => [],
  loadSchema(): Promise<SchemaBundle | undefined> {
    return loadComposeSchema();
  },
  guide: composeGuide,
};
