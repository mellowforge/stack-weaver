import type { FormatVariables } from '../../types.js';
import { VARIABLES_KEY, readBlock, removeBlockOps, writeBlockOps } from './block.js';
import { substituteData } from './substitute.js';
import { referenceOf } from './syntax.js';

/** Compose variable support: the `x-variables` block and `${NAME}` placeholders. */
export const composeVariables: FormatVariables = {
  key: VARIABLES_KEY,
  read: (p) => readBlock(p).decls,
  writeOps: writeBlockOps,
  removeOps: removeBlockOps,
  referenceOf,
  reference: (name) => `\${${name}}`,
  substitute: (data, decls) => substituteData(data, decls, VARIABLES_KEY),
};
