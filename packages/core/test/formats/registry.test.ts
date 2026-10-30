import { beforeEach, describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { detectFormat, getFormat, registerFormat, resetFormats } from '../../src/formats/registry.js';
import type { FormatDefinition } from '../../src/formats/types.js';

const make = (id: string, detects: boolean): FormatDefinition => ({
  id,
  label: id,
  version: '1',
  rootModel: 'documents',
  detect: () => detects,
  kinds: () => [],
  loadSchema: async () => undefined,
  guide: { groups: [], kinds: {}, fields: {} },
});

describe('format registry', () => {
  beforeEach(() => resetFormats());

  it('registerFormat rejects duplicate id', () => {
    registerFormat(make('a', true));
    expect(() => registerFormat(make('a', true))).toThrow(/a/);
    expect(getFormat('a')?.id).toBe('a');
    expect(getFormat('zzz')).toBeUndefined();
  });

  it('re-registering the identical object is a no-op; another object with the same id throws', () => {
    const a = make('a', true);
    registerFormat(a);
    expect(() => registerFormat(a)).not.toThrow();
    expect(getFormat('a')).toBe(a);
    expect(() => registerFormat({ ...a })).toThrow(/already registered/);
  });

  it('detectFormat uses an explicit list instead of the registry when given', () => {
    const p = parseText('a: 1\n');
    registerFormat(make('registered', true));
    const listed = make('listed', true);
    expect(detectFormat(p, [make('no', false), listed])).toBe(listed);
    expect(detectFormat(p, [])).toBeUndefined();
    expect(detectFormat(p)?.id).toBe('registered');
  });

  it('detectFormat returns first matching', () => {
    const p = parseText('a: 1\n');
    expect(detectFormat(p)).toBeUndefined();
    registerFormat(make('no', false));
    registerFormat(make('first', true));
    registerFormat(make('second', true));
    expect(detectFormat(p)?.id).toBe('first');
  });
});
