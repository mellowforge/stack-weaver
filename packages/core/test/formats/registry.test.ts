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

  it('detectFormat returns first matching', () => {
    const p = parseText('a: 1\n');
    expect(detectFormat(p)).toBeUndefined();
    registerFormat(make('no', false));
    registerFormat(make('first', true));
    registerFormat(make('second', true));
    expect(detectFormat(p)?.id).toBe('first');
  });
});
