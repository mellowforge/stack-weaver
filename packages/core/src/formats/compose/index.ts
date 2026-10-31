import { isMap } from 'yaml';
import { isEmptyDocument } from '../../document/data.js';
import type { ParsedText } from '../../document/types.js';
import { deepFreeze } from '../freeze.js';
import type { FormatDefinition, SchemaBundle } from '../types.js';
import { composeGuide } from './guide.js';
import { loadComposeSchema } from './loader.js';
import { composeRecipes } from './recipes.js';
import { composeVariables } from './variables/index.js';

const TOP_LEVEL_KEYS = ['services', 'networks', 'volumes', 'configs', 'secrets', 'include'];

/** The Docker Compose format: a single root mapping validated against the compose-spec schema. */
export const composeFormat: FormatDefinition = deepFreeze<FormatDefinition>({
  id: 'compose',
  label: 'Docker Compose',
  // First 7 characters of the compose-spec commit pinned in schema-sources.lock.json ("compose").
  version: '3a4a699',
  rootModel: 'mapping',
  /**
   * True when the text parses into exactly one non-empty document: a mapping without `apiVersion`
   * that has a compose top-level key (`services`, `networks`, `volumes`, `configs`, `secrets` or
   * `include`).
   */
  detect(p: ParsedText): boolean {
    const docs = p.docs.filter((_, i) => !isEmptyDocument(p, i));
    if (!p.ok || docs.length !== 1) return false;
    const root = docs[0]?.contents;
    if (!isMap(root)) return false;
    return !root.has('apiVersion') && TOP_LEVEL_KEYS.some((k) => root.has(k));
  },
  kinds: () => [],
  loadSchema(): Promise<SchemaBundle | undefined> {
    return loadComposeSchema();
  },
  guide: composeGuide,
  recipes: composeRecipes,
  variables: composeVariables,
});
