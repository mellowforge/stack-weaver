import { toData } from '../../../document/data.js';
import type { EditOp } from '../../../document/edit.js';
import { renderValue } from '../../../document/render.js';
import type { NodeRef, ParsedText, YamlPath, YamlValue } from '../../../document/types.js';
import { validateVariableDecl } from '../../../variables/decl.js';
import type { VariableDecl } from '../../types.js';

/** The root key of the compose block that declares variables. */
export const VARIABLES_KEY = 'x-variables';

/** One malformed entry of the declaration block. */
export interface DeclarationIssue {
  /** The entry's key. */
  readonly name: string;
  /** Path of the most specific offending node. */
  readonly path: YamlPath;
  /** What is wrong. */
  readonly reason: 'notMapping' | 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField';
}

type Raw = Record<string, unknown>;

const FIELDS = ['type', 'enum', 'default', 'description'];
const isRecord = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const ref = (...path: (string | number)[]): NodeRef => ({ doc: 0, path });

/** The block's raw value (`undefined` when absent) and whether the root can hold one. */
function rawBlock(p: ParsedText): { rootOk: boolean; block: unknown } {
  if (p.docCount === 0) return { rootOk: false, block: undefined };
  let root: unknown;
  try {
    root = toData(p, 0);
  } catch {
    return { rootOk: false, block: undefined };
  }
  return isRecord(root) ? { rootOk: true, block: root[VARIABLES_KEY] } : { rootOk: false, block: undefined };
}

/**
 * True when the block can be read: the first document's data can be built (no bad merge) and its
 * root is a mapping. While it cannot, the block's declarations are unknown rather than none.
 */
export function blockReadable(p: ParsedText): boolean {
  return rawBlock(p).rootOk;
}

/** Builds a decl from one entry, or the single issue that makes it malformed. */
function readEntry(
  name: string,
  raw: unknown,
  path: YamlPath,
): { decl: VariableDecl } | { issue: DeclarationIssue } {
  const fail = (reason: DeclarationIssue['reason'], at: YamlPath = path) => ({ issue: { name, path: at, reason } });
  if (!isRecord(raw)) return fail('notMapping');
  for (const k of Object.keys(raw)) if (!FIELDS.includes(k)) return fail('badField', [...path, k]);
  if (raw.type === undefined) return fail('badType');
  if (typeof raw.type !== 'string') return fail('badField', [...path, 'type']);
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return fail('badField', [...path, 'description']);
  }
  const list = raw.enum;
  if (list !== undefined && raw.type !== 'enum') return fail('badField', [...path, 'enum']);
  const candidate = {
    name,
    type: raw.type,
    ...(list !== undefined ? { enumValues: list } : {}),
    ...(raw.default !== undefined ? { default: raw.default } : {}),
    ...(raw.description !== undefined ? { description: raw.description } : {}),
  };
  const reason = validateVariableDecl(candidate);
  if (reason === undefined) return { decl: candidate as VariableDecl };
  if (reason === 'noEnumValues') return fail(reason, list === undefined ? path : [...path, 'enum']);
  if (reason === 'badType') return fail(reason, [...path, 'type']);
  if (reason === 'badDefault') return fail(reason, [...path, 'default']);
  return fail(reason);
}

/**
 * Reads the `x-variables` block of the first document. Valid entries become declarations, in
 * order; each malformed entry gives exactly one issue. A block that is not a mapping is one
 * `notMapping` issue and no declarations.
 */
export function readBlock(p: ParsedText): {
  readonly decls: readonly VariableDecl[];
  readonly issues: readonly DeclarationIssue[];
} {
  const { block } = rawBlock(p);
  if (block === undefined || block === null) return { decls: [], issues: [] };
  if (!isRecord(block)) {
    return { decls: [], issues: [{ name: VARIABLES_KEY, path: [VARIABLES_KEY], reason: 'notMapping' }] };
  }
  const decls: VariableDecl[] = [];
  const issues: DeclarationIssue[] = [];
  for (const [name, raw] of Object.entries(block)) {
    const r = readEntry(name, raw, [VARIABLES_KEY, name]);
    if ('decl' in r) decls.push(r.decl);
    else issues.push(r.issue);
  }
  return { decls, issues };
}

const entryValue = (d: VariableDecl): Raw => ({
  type: d.type,
  ...(d.type === 'enum' ? { enum: [...d.enumValues] } : {}),
  ...(d.default !== undefined ? { default: d.default } : {}),
  ...(d.description !== undefined ? { description: d.description } : {}),
});

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Ops that add `decl` to the block (creating it when missing) or replace the entry named
 * `replaces ?? decl.name` field by field, so the entry's position and comments survive. A text
 * with no document (empty, or comments only) gains one holding the block, after the text as it is.
 * `undefined` when the root is not a mapping or the block cannot hold entries.
 */
export function writeBlockOps(p: ParsedText, decl: VariableDecl, replaces?: string): readonly EditOp[] | undefined {
  const fresh = entryValue(decl);
  if (p.docCount === 0) {
    if (replaces !== undefined) return undefined;
    return [{ op: 'addDocument', yaml: renderValue({ [VARIABLES_KEY]: { [decl.name]: fresh } }, 0, p.eol) }];
  }
  const { rootOk, block } = rawBlock(p);
  if (!rootOk) return undefined;
  if (block === undefined) {
    return [{ op: 'add', at: ref(), key: VARIABLES_KEY, value: { [decl.name]: fresh } as YamlValue }];
  }
  if (block !== null && !isRecord(block)) return undefined;
  const from = replaces ?? decl.name;
  const old = isRecord(block) && Object.hasOwn(block, from) ? block[from] : undefined;
  if (!isRecord(old)) {
    const ops: EditOp[] = [];
    if (old !== undefined) ops.push({ op: 'delete', at: ref(VARIABLES_KEY, from) });
    ops.push({ op: 'add', at: ref(VARIABLES_KEY), key: decl.name, value: fresh as YamlValue });
    return ops;
  }
  const ops: EditOp[] = [];
  if (from !== decl.name) ops.push({ op: 'renameKey', at: ref(VARIABLES_KEY, from), key: decl.name });
  for (const field of FIELDS) {
    const before = old[field];
    const after = fresh[field];
    if (same(before, after)) continue;
    const at = ref(VARIABLES_KEY, decl.name, field);
    if (after === undefined) ops.push({ op: 'delete', at });
    else if (before === undefined) {
      ops.push({ op: 'add', at: ref(VARIABLES_KEY, decl.name), key: field, value: after as YamlValue });
    } else if (field === 'enum') {
      ops.push({ op: 'delete', at }, { op: 'add', at: ref(VARIABLES_KEY, decl.name), key: field, value: after as YamlValue });
    } else ops.push({ op: 'set', at, value: after as string | number | boolean });
  }
  return ops;
}

/** Ops that delete the entry `name`, or the whole block when it was the only entry. */
export function removeBlockOps(p: ParsedText, name: string): readonly EditOp[] {
  const { block } = rawBlock(p);
  if (!isRecord(block) || !Object.hasOwn(block, name)) return [];
  const only = Object.keys(block).length === 1;
  return [{ op: 'delete', at: only ? ref(VARIABLES_KEY) : ref(VARIABLES_KEY, name) }];
}
