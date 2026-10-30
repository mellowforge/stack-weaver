export const VERSION = '0.1.0';

// Document model
export type { YamlPath, NodeRef, TextChange, YamlProblem, ParsedText } from './document/types.js';
export { parseText } from './document/parse.js';
export { getNode, refAtOffset, toLineCol } from './document/paths.js';
export { applyEdit, canEdit } from './document/edit.js';
export type { ScalarValue, EditOp, EditBlock, EditResult } from './document/edit.js';
export { diffText } from './document/diff.js';
export { DocumentStore } from './document/store.js';
export type { ChangeOrigin, StoreEvent, StoreOptions } from './document/store.js';
export { toData } from './document/data.js';

// Formats
export type {
  JsonSchema,
  SchemaError,
  ValidateFn,
  SchemaBundle,
  KindEntry,
  GuideField,
  Guide,
  FormatDefinition,
} from './formats/types.js';
export { registerFormat, getFormat, detectFormat } from './formats/registry.js';
export { mergeGuide, guideField } from './formats/guide.js';

// Engine
export { resolveAt } from './engine/resolve.js';
export type { ResolvedSchema } from './engine/resolve.js';
export { addableAt } from './engine/addable.js';
export type { Tier, AddableItem } from './engine/addable.js';
export { kindCatalog } from './engine/catalog.js';
export type { CatalogGroup } from './engine/catalog.js';

// Validation
export { validateText } from './validation/validate.js';
export type { Severity, Problem } from './validation/problems.js';
export type { Messages } from './validation/messages.js';
