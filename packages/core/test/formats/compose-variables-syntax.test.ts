import { describe, expect, it } from 'vitest';
import type { VariableDecl } from '../../src/formats/types.js';
import { referenceOf, scanPlaceholders } from '../../src/formats/compose/variables/syntax.js';
import { substituteData, substituteValue } from '../../src/formats/compose/variables/substitute.js';

const decls = (...list: VariableDecl[]): ReadonlyMap<string, VariableDecl> =>
  new Map(list.map((d) => [d.name, d]));

describe('scanPlaceholders', () => {
  it.each([
    ['${A}', [{ name: 'A', start: 0, end: 4 }]],
    ['$A', [{ name: 'A', start: 0, end: 2 }]],
    ['x-${A:-d}-y', [{ name: 'A', start: 2, end: 9, op: ':-', arg: 'd' }]],
    ['${A:?need A}', [{ name: 'A', start: 0, end: 12, op: ':?', arg: 'need A' }]],
    ['${A:-${B}}', [{ name: 'A', start: 0, end: 10, op: ':-', arg: '${B}' }]],
    ['${A+x}', [{ name: 'A', start: 0, end: 6, op: '+', arg: 'x' }]],
    ['$$', []],
    ['$${A}', []],
    ['$$A', []],
    ['$$$A', [{ name: 'A', start: 2, end: 4 }]],
    ['${', []],
    ['${A', []],
    ['${A:-${B}', [{ name: 'B', start: 5, end: 9 }]],
    ['${1X}', []],
    ['$ 5', []],
    ['cost: $5', []],
    ['$A$B', [{ name: 'A', start: 0, end: 2 }, { name: 'B', start: 2, end: 4 }]],
  ])('scanPlaceholders(%j)', (s, want) => expect(scanPlaceholders(s)).toEqual(want));
});

describe('referenceOf', () => {
  it('reports whole-value placeholders only', () => {
    expect(referenceOf('${A}')).toBe('A');
    expect(referenceOf('${A:-x}')).toBe('A');
    expect(referenceOf('$A')).toBe('A');
    expect(referenceOf('x${A}')).toBeUndefined();
    expect(referenceOf('${A}x')).toBeUndefined();
    expect(referenceOf('$${A}')).toBeUndefined();
    expect(referenceOf('plain')).toBeUndefined();
  });
});

describe('substituteValue', () => {
  it('substitutes whole placeholders with the declared type', () => {
    const d = decls(
      { name: 'P', type: 'port', default: 8080 },
      { name: 'N', type: 'number', default: '3' },
      { name: 'B', type: 'boolean', default: true },
      { name: 'E', type: 'enum', enumValues: ['dev', 'prod'], default: 'dev' },
      { name: 'S', type: 'string', default: 'x' },
    );
    expect(substituteValue('${P}', d)).toEqual({ value: 8080, typeOnly: false });
    expect(substituteValue('${N}', d)).toEqual({ value: 3, typeOnly: false });
    expect(substituteValue('${B}', d)).toEqual({ value: true, typeOnly: false });
    expect(substituteValue('${E}', d)).toEqual({ value: 'dev', typeOnly: false });
    expect(substituteValue('$S', d)).toEqual({ value: 'x', typeOnly: false });
  });

  it('lets the inline default win and coerces it to the declared type', () => {
    const d = decls({ name: 'P', type: 'port', default: 80 });
    expect(substituteValue('${P:-81}', d)).toEqual({ value: 81, typeOnly: false });
    expect(substituteValue('${P-81}', d)).toEqual({ value: 81, typeOnly: false });
  });

  it('keeps a non-numeric or non-boolean inline default as a string', () => {
    const d = decls({ name: 'P', type: 'port' }, { name: 'B', type: 'boolean' });
    expect(substituteValue('${P:-abc}', d)).toEqual({ value: 'abc', typeOnly: false });
    expect(substituteValue('${B:-maybe}', d)).toEqual({ value: 'maybe', typeOnly: false });
    expect(substituteValue('${B:-false}', d)).toEqual({ value: false, typeOnly: false });
  });

  it('substitutes the text of an undeclared name with an inline default', () => {
    expect(substituteValue('${X:-a}', decls())).toEqual({ value: 'a', typeOnly: false });
    expect(substituteValue('${X:-80}', decls())).toEqual({ value: '80', typeOnly: false });
  });

  it('substitutes a nested default recursively', () => {
    const d = decls({ name: 'B', type: 'number', default: 5 });
    expect(substituteValue('${A:-${B}}', d)).toEqual({ value: '5', typeOnly: false });
    expect(substituteValue('${A:-${C}}', d)).toEqual({ value: '${A:-${C}}', typeOnly: true });
  });

  it('is typeOnly with the original string when no default exists', () => {
    const d = decls({ name: 'P', type: 'port' });
    expect(substituteValue('${P}', d)).toEqual({ value: '${P}', typeOnly: true });
    expect(substituteValue('${Q}', d)).toEqual({ value: '${Q}', typeOnly: true });
    expect(substituteValue('a-${P}-b', d)).toEqual({ value: 'a-${P}-b', typeOnly: true });
  });

  it('treats :? ? :+ + as having no inline default', () => {
    const d = decls({ name: 'P', type: 'port' }, { name: 'D', type: 'string', default: 'd' });
    expect(substituteValue('${P:?need}', d).typeOnly).toBe(true);
    expect(substituteValue('${P?need}', d).typeOnly).toBe(true);
    expect(substituteValue('${P:+x}', d).typeOnly).toBe(true);
    expect(substituteValue('${D+x}', d).typeOnly).toBe(true);
    expect(substituteValue('${D:?need}', d)).toEqual({ value: 'd', typeOnly: false });
  });

  it('substitutes placeholders inside text as text', () => {
    const d = decls({ name: 'TAG', type: 'string', default: '1.2' }, { name: 'P', type: 'port', default: 80 });
    expect(substituteValue('img:${TAG}', d)).toEqual({ value: 'img:1.2', typeOnly: false });
    expect(substituteValue('${P}:${P}', d)).toEqual({ value: '80:80', typeOnly: false });
  });

  it('leaves literals and escapes alone', () => {
    expect(substituteValue('cost $5 $$A', decls())).toEqual({ value: 'cost $5 $$A', typeOnly: false });
  });
});

describe('substituteData', () => {
  const list: VariableDecl[] = [
    { name: 'P', type: 'port', default: 80 },
    { name: 'Q', type: 'port' },
  ];

  it('skips the declaration block and never mutates its input', () => {
    const data = {
      'x-variables': { P: { default: '${P}' } },
      services: { web: { image: 'img:${P}', replicas: 2 } },
    };
    const copy = structuredClone(data);
    const out = substituteData(data, list, 'x-variables');
    expect(data).toEqual(copy);
    expect(out.data).toEqual({
      'x-variables': { P: { default: '${P}' } },
      services: { web: { image: 'img:80', replicas: 2 } },
    });
    expect(out.data).not.toBe(data);
    expect(out.skip).toEqual([]);
  });

  it('reports skip paths of typeOnly scalars, including inside sequences', () => {
    const data = { services: { web: { ports: ['${Q}', '${P}:80'], image: 'a' } } };
    const out = substituteData(data, list, 'x-variables');
    expect(out.skip).toEqual([['services', 'web', 'ports', 0]]);
    expect(out.data).toEqual({ services: { web: { ports: ['${Q}', '80:80'], image: 'a' } } });
  });

  it('only skips the key at the root', () => {
    const out = substituteData({ a: { 'x-variables': '${P}' } }, list, 'x-variables');
    expect(out.data).toEqual({ a: { 'x-variables': 80 } });
  });

  it('passes non-container, non-string values through', () => {
    expect(substituteData(null, list, 'k').data).toBeNull();
    expect(substituteData(5, list, 'k').data).toBe(5);
  });
});
