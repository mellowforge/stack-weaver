import { describe, expect, it } from 'vitest';
import { fieldTypes, fitsField, inferVariableType } from '../../src/variables/fit.js';

describe('fitsField', () => {
  it.each([
    [{ type: 'port' }, { type: ['integer', 'string'] }, true],
    [{ type: 'boolean' }, { type: ['integer', 'string'] }, false],
    [{ type: 'string' }, { type: ['boolean', 'string'] }, false],
    [{ type: 'boolean' }, { type: ['boolean', 'string'] }, true],
    [{ type: 'string' }, { type: 'string' }, true],
    [{ type: 'port' }, { type: 'string', pattern: '^x$' }, true],
    [{ type: 'enum', enumValues: ['a'] }, { type: 'string', enum: ['a', 'b'] }, true],
    [{ type: 'enum', enumValues: ['c'] }, { type: 'string', enum: ['a', 'b'] }, false],
    [{ type: 'number' }, { type: 'integer' }, true],
    [{ type: 'number' }, { type: 'string' }, false],
    [{ type: 'boolean' }, { anyOf: [{ type: 'boolean' }, { type: 'string' }] }, true],
    [{ type: 'boolean' }, {}, true],
    // R20: only [T, 'string'] (T boolean, integer or number; 'null' ignored) drops 'string'
    [{ type: 'string' }, { type: ['string', 'number', 'boolean', 'null'] }, true],
    [{ type: 'boolean' }, { type: ['string', 'number', 'boolean', 'null'] }, true],
    [{ type: 'port' }, { type: ['string', 'number', 'boolean', 'null'] }, true],
    [{ type: 'enum', enumValues: ['a'] }, { type: ['string', 'number', 'boolean', 'null'] }, true],
    [{ type: 'string' }, { type: ['boolean', 'string', 'null'] }, false],
  ])('fitsField(%j, %j) is %s', (decl, schema, want) => {
    expect(fitsField(decl as never, schema)).toBe(want);
  });
});

describe('fieldTypes', () => {
  it('reads type lists, branches and enum value types', () => {
    expect([...fieldTypes({ type: ['integer', 'string'] })]).toEqual(['integer']);
    expect([...fieldTypes({ type: ['string', 'null'] })]).toEqual(['string']);
    expect([...fieldTypes({ type: ['boolean', 'string', 'null'] })]).toEqual(['boolean']);
    expect([...fieldTypes({ type: ['string', 'number', 'boolean', 'null'] })].sort()).toEqual(['boolean', 'number', 'string']);
    expect([...fieldTypes({ oneOf: [{ type: 'number' }, { type: 'string' }, { type: 'object' }] })].sort()).toEqual([
      'number',
      'string',
    ]);
    expect([...fieldTypes({ enum: [true, 'x'] })].sort()).toEqual(['boolean', 'string']);
  });
});

describe('inferVariableType', () => {
  it.each([
    [{ type: ['integer', 'string'] }, 'number'],
    [{ type: ['boolean', 'string'] }, 'boolean'],
    [{ type: 'string' }, 'string'],
    [{ type: ['string', 'number', 'boolean', 'null'] }, 'string'],
    [{}, 'string'],
  ])('%j gives %s', (schema, want) => expect(inferVariableType(schema)).toBe(want));
});
