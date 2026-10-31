import { deepFreeze } from '../freeze.js';
import type { DetectInput, FormatDefinition, SchemaBundle } from '../types.js';
import { composeGuide } from './guide.js';
import { loadComposeSchema } from './loader.js';
import { composeRecipes } from './recipes.js';
import { composeVariables } from './variables/index.js';
import { composeRules } from './variables/rules.js';

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
  detect(input: DetectInput): boolean {
    const docs = input.docs.filter((d) => d !== undefined);
    const root = docs[0];
    if (docs.length !== 1 || typeof root !== 'object' || root === null || Array.isArray(root)) return false;
    return !Object.hasOwn(root, 'apiVersion') && TOP_LEVEL_KEYS.some((k) => Object.hasOwn(root, k));
  },
  kinds: () => [],
  loadSchema(): Promise<SchemaBundle | undefined> {
    return loadComposeSchema();
  },
  guide: composeGuide,
  recipes: composeRecipes,
  variables: composeVariables,
  rules: composeRules,
});
