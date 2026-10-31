import { describe, expect, it } from 'vitest';
import type { EnumVariable, NumberVariable, VariableDecl } from '../../src/formats/types.js';
import { VARIABLE_TYPES, validateVariableDecl } from '../../src/variables/decl.js';

describe('validateVariableDecl', () => {
  it('accepts each valid member and names the issue of each invalid one', () => {
    const valid: VariableDecl[] = [
      { name: 'S', type: 'string' },
      { name: 'S2', type: 'string', default: 'x', description: 'text' },
      { name: 'N', type: 'number', default: 1.5 },
      { name: 'B', type: 'boolean', default: false },
      { name: 'P', type: 'port', default: 8080 },
      { name: 'E', type: 'enum', enumValues: ['a', 'b'], default: 'b' },
      { name: '_x1', type: 'string' },
    ];
    for (const d of valid) expect(validateVariableDecl(d), d.name).toBeUndefined();

    const invalid: [unknown, string][] = [
      [{ type: 'string' }, 'badName'],
      [{ name: '1x', type: 'string' }, 'badName'],
      [{ name: 5, type: 'string' }, 'badName'],
      [{ name: 'A' }, 'badType'],
      [{ name: 'A', type: 'date' }, 'badType'],
      [{ name: 'A', type: 5 }, 'badType'],
      [{ name: 'A', type: 'enum' }, 'noEnumValues'],
      [{ name: 'A', type: 'enum', enumValues: [] }, 'noEnumValues'],
      [{ name: 'A', type: 'enum', enumValues: ['a', 1] }, 'noEnumValues'],
      [{ name: 'A', type: 'enum', enumValues: 'a' }, 'noEnumValues'],
      [{ name: 'A', type: 'string', default: 1 }, 'badDefault'],
      [{ name: 'A', type: 'number', default: Number.NaN }, 'badDefault'],
      [{ name: 'A', type: 'boolean', default: 'true' }, 'badDefault'],
      [{ name: 'A', type: 'port', default: 0 }, 'badDefault'],
      [{ name: 'A', type: 'port', default: 70000 }, 'badDefault'],
      [{ name: 'A', type: 'port', default: 80.5 }, 'badDefault'],
      [{ name: 'A', type: 'enum', enumValues: ['a'], default: 'z' }, 'badDefault'],
      [{ name: 'A', type: 'string', description: 5 }, 'badField'],
      [{ name: 'A', type: 'string', enumValues: ['a'] }, 'badField'],
    ];
    for (const [d, issue] of invalid) expect(validateVariableDecl(d), JSON.stringify(d)).toBe(issue);
  });

  it('rejects non-objects and unknown fields', () => {
    for (const v of [5, null, undefined, 'x', [], [{ name: 'A', type: 'string' }]]) {
      expect(validateVariableDecl(v)).toBe('badField');
    }
    expect(validateVariableDecl({ name: 'A', type: 'string', x: 1 })).toBe('badField');
  });

  it('lists the five types', () => {
    expect(VARIABLE_TYPES).toEqual(['string', 'number', 'boolean', 'port', 'enum']);
  });

  it('enumValues on a non-enum is a type error', () => {
    // @ts-expect-error enumValues exists only on the enum member
    const bad: NumberVariable = { name: 'A', type: 'number', enumValues: ['a'] };
    expect(validateVariableDecl(bad)).toBe('badField');
    // @ts-expect-error the enum member requires enumValues
    const missing: EnumVariable = { name: 'A', type: 'enum' };
    expect(validateVariableDecl(missing)).toBe('noEnumValues');
    // @ts-expect-error the default is typed per member
    const wrong: NumberVariable = { name: 'A', type: 'number', default: 'x' };
    expect(validateVariableDecl(wrong)).toBe('badDefault');
  });
});
