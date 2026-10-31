import { describe, expect, it } from 'vitest';
import { applyEdit } from '../../src/document/edit.js';
import type { EditOp } from '../../src/document/edit.js';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { VARIABLES_KEY, readBlock } from '../../src/formats/compose/variables/block.js';
import { composeVariables } from '../../src/formats/compose/variables/index.js';
import type { VariableDecl } from '../../src/formats/types.js';
import { validateText } from '../../src/validation/validate.js';

function apply(text: string, ops: readonly EditOp[] | undefined): string {
  expect(ops).toBeDefined();
  let out = text;
  for (const op of ops as readonly EditOp[]) {
    const r = applyEdit(parseText(out), op);
    if (!r.ok) throw new Error(`edit refused: ${r.reason}`);
    out = r.text;
  }
  return out;
}

const SERVICES = 'services:\n  web:\n    image: nginx\n';

describe('readBlock', () => {
  it('reads valid entries in order and reports each malformed one once', () => {
    const p = parseText(
      [
        'x-variables:',
        '  WEB_PORT:',
        '    type: port',
        '    default: 8080',
        '  BAD:',
        '    type: colour',
        '  E:',
        '    type: enum',
        '  N:',
        '    type: number',
        "    default: 'x'",
        '  S: 5',
        SERVICES,
      ].join('\n'),
    );
    const { decls, issues } = readBlock(p);
    expect(decls).toEqual([{ name: 'WEB_PORT', type: 'port', default: 8080 }]);
    expect(issues).toEqual([
      { name: 'BAD', path: ['x-variables', 'BAD', 'type'], reason: 'badType' },
      { name: 'E', path: ['x-variables', 'E'], reason: 'noEnumValues' },
      { name: 'N', path: ['x-variables', 'N', 'default'], reason: 'badDefault' },
      { name: 'S', path: ['x-variables', 'S'], reason: 'notMapping' },
    ]);
  });

  it('reports unknown and non-string fields as badField, and bad names as badName', () => {
    const p = parseText(
      'x-variables:\n  A:\n    type: string\n    colour: red\n  B:\n    type: 5\n  C:\n    type: string\n    enum: [a]\n  1X:\n    type: string\n',
    );
    expect(readBlock(p).issues).toEqual([
      { name: 'A', path: ['x-variables', 'A', 'colour'], reason: 'badField' },
      { name: 'B', path: ['x-variables', 'B', 'type'], reason: 'badField' },
      { name: 'C', path: ['x-variables', 'C', 'enum'], reason: 'badField' },
      { name: '1X', path: ['x-variables', '1X'], reason: 'badName' },
    ]);
  });

  it('reads enum entries and checks port range', () => {
    const p = parseText(
      'x-variables:\n  E:\n    type: enum\n    enum: [a, b]\n    default: b\n    description: pick\n  P:\n    type: port\n    default: 70000\n',
    );
    const { decls, issues } = readBlock(p);
    expect(decls).toEqual([{ name: 'E', type: 'enum', enumValues: ['a', 'b'], default: 'b', description: 'pick' }]);
    expect(issues).toEqual([{ name: 'P', path: ['x-variables', 'P', 'default'], reason: 'badDefault' }]);
  });

  it('a non-mapping block is one notMapping issue and no decls', () => {
    const { decls, issues } = readBlock(parseText(`x-variables: [a]\n${SERVICES}`));
    expect(decls).toEqual([]);
    expect(issues).toEqual([{ name: 'x-variables', path: ['x-variables'], reason: 'notMapping' }]);
  });

  it('no block is no decls and no issues', () => {
    expect(readBlock(parseText(SERVICES))).toEqual({ decls: [], issues: [] });
  });
});

describe('composeVariables.writeOps', () => {
  const port: VariableDecl = { name: 'WEB_PORT', type: 'port', default: 8080 };

  it('creates the block on a compose file without one, leaving other lines byte-identical', () => {
    const text = `# my stack\r\n${SERVICES.replace(/\n/g, '\r\n')}`;
    const out = apply(text, composeVariables.writeOps(parseText(text), port));
    expect(out).toContain('x-variables:');
    expect(out).toContain('default: 8080');
    expect(out).not.toContain("'8080'");
    const stripped = out.split('\r\n').filter((l) => !/x-variables|WEB_PORT|type: port|default: 8080/.test(l));
    expect(stripped.join('\r\n')).toBe(text);
    expect(readBlock(parseText(out)).decls).toEqual([port]);
  });

  it('adds under an existing block and writes typed defaults', () => {
    const text = `x-variables:\n  A:\n    type: string\n${SERVICES}`;
    const out = apply(text, composeVariables.writeOps(parseText(text), port));
    expect(out).toContain('default: 8080');
    expect(out).not.toContain("'8080'");
    expect(readBlock(parseText(out)).decls.map((d) => d.name)).toEqual(['A', 'WEB_PORT']);
  });

  it('replace keeps position and comments; rename uses renameKey', () => {
    const text = [
      'x-variables:',
      '  # the port',
      '  WEB_PORT:',
      '    type: port # kind',
      '    default: 8080',
      '    description: old',
      '  OTHER:',
      '    type: string',
      SERVICES,
    ].join('\n');
    const next: VariableDecl = { name: 'HTTP_PORT', type: 'port', default: 9090 };
    const ops = composeVariables.writeOps(parseText(text), next, 'WEB_PORT');
    expect(ops?.map((o) => o.op)).toEqual(['renameKey', 'set', 'delete']);
    const out = apply(text, ops);
    expect(out).toBe(
      text
        .replace('WEB_PORT:', 'HTTP_PORT:')
        .replace('default: 8080', 'default: 9090')
        .replace('    description: old\n', ''),
    );
    expect(readBlock(parseText(out)).decls.map((d) => d.name)).toEqual(['HTTP_PORT', 'OTHER']);
  });

  it('changes an enum list by delete and add, and adds new fields', () => {
    const text = 'x-variables:\n  E:\n    type: enum\n    enum: [a, b]\n' + SERVICES;
    const next: VariableDecl = { name: 'E', type: 'enum', enumValues: ['a', 'c'], default: 'c', description: 'd' };
    const ops = composeVariables.writeOps(parseText(text), next);
    expect(ops?.map((o) => o.op)).toEqual(['delete', 'add', 'add', 'add']);
    expect(readBlock(parseText(apply(text, ops))).decls).toEqual([next]);
  });

  it('returns undefined when the root is not a mapping', () => {
    expect(composeVariables.writeOps(parseText('- a\n- b\n'), port)).toBeUndefined();
  });
});

describe('composeVariables.removeOps', () => {
  it('deletes the entry, and the block with its last entry', () => {
    const text = `x-variables:\n  A:\n    type: string\n  B:\n    type: string\n${SERVICES}`;
    const one = apply(text, composeVariables.removeOps(parseText(text), 'A'));
    expect(one).toBe(`x-variables:\n  B:\n    type: string\n${SERVICES}`);
    const none = apply(one, composeVariables.removeOps(parseText(one), 'B'));
    expect(none).toBe(SERVICES);
  });

  it('is empty for an unknown name', () => {
    expect(composeVariables.removeOps(parseText(SERVICES), 'A')).toEqual([]);
  });
});

describe('composeVariables basics', () => {
  it('has the block key and writes bare references', () => {
    expect(composeVariables.key).toBe(VARIABLES_KEY);
    expect(composeVariables.reference('PULL')).toBe('${PULL}');
    expect(composeVariables.referenceOf('${PULL}')).toBe('PULL');
  });
});

describe('validateText on compose with variables', () => {
  const doc = (decl: string): string =>
    `x-variables:\n  PULL:\n    type: string\n${decl}services:\n  web:\n    image: nginx\n    pull_policy: "\${PULL}"\n`;
  const atPull = (ps: Awaited<ReturnType<typeof validateText>>) =>
    ps.filter((p) => p.path.join('.') === 'services.web.pull_policy');

  it('pull_policy "${PULL}" with PULL default always → no problem', async () => {
    const ps = await validateText(parseText(doc('    default: always\n')), composeFormat);
    expect(atPull(ps)).toEqual([]);
  });

  it('PULL default bogus → schema.pattern at pull_policy', async () => {
    const ps = await validateText(parseText(doc('    default: bogus\n')), composeFormat);
    expect(atPull(ps).map((p) => p.code)).toEqual(['schema.pattern']);
  });

  it('PULL declared without default → no schema problem at pull_policy', async () => {
    const ps = await validateText(parseText(doc('')), composeFormat);
    expect(atPull(ps)).toEqual([]);
  });
});
