/** The version of `@stack-weaver/core`, generated from its package.json by `scripts/gen-version.mjs`. */
export { VERSION } from './version.js';

// Document model
export type { YamlPath, NodeRef, TextRange, Position, TextChange, YamlProblem, ParsedText, ScalarValue, YamlValue } from './document/types.js';
export { parseText } from './document/parse.js';
export { getNode, refAtOffset, toLineCol } from './document/paths.js';
export { applyEdit, canEdit } from './document/edit.js';
export type { EditOp, EditRefusal, EditResult } from './document/edit.js';
export { diffText } from './document/diff.js';
export { DocumentStore } from './document/store.js';
export type { ChangeOrigin, StoreEvent, StoreOptions } from './document/store.js';
export { toData } from './document/data.js';
export { describeNode } from './document/describe.js';
export type { NodeView } from './document/describe.js';

// Formats
export type {
  JsonSchema,
  SchemaError,
  ValidateFn,
  SchemaBundle,
  KindEntry,
  GuideField,
  Guide,
  GuideGroup,
  GuideKind,
  GuideOverride,
  Tier,
  FormatDefinition,
} from './formats/types.js';
export { registerFormat, getFormat, detectFormat } from './formats/registry.js';
export { mergeGuide, guideField, kindKey } from './formats/guide.js';

// Engine
export { resolveAt } from './engine/resolve.js';
export type { ResolvedSchema } from './engine/resolve.js';
export { addableAt, valueTemplateAt } from './engine/addable.js';
export type { AddableItem } from './engine/addable.js';
export { kindCatalog } from './engine/catalog.js';
export type { CatalogGroup, KindCatalog } from './engine/catalog.js';

// Validation
export { validateText } from './validation/validate.js';
export type { Severity, Problem, ProblemSource } from './validation/problems.js';
export { defaultMessages } from './validation/messages.js';
export type { SchemaMessages, MessageFn } from './validation/messages.js';
