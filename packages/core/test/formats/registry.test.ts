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

describe('detectFormat input', () => {
  beforeEach(() => resetFormats());
  const spy = (seen: unknown[]): FormatDefinition => ({ ...make('spy', false), detect: (input) => (seen.push(input), false) });

  it('builds the DetectInput once and gives every format the same object', () => {
    const seen: unknown[] = [];
    detectFormat(parseText('a: 1\n---\nb: 2\n'), [spy(seen), spy(seen)]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).toEqual({ docs: [{ a: 1 }, { b: 2 }] });
  });

  it('gives undefined for empty or unbuildable documents and no documents for broken text', () => {
    const seen: { docs: unknown[] }[] = [];
    detectFormat(parseText('a: 1\n---\n---\nb: {<<: 5}\n'), [spy(seen)]);
    expect(seen[0]!.docs).toEqual([{ a: 1 }, undefined, undefined]);
    detectFormat(parseText('a: [\n'), [spy(seen)]);
    expect(seen[1]!.docs).toEqual([]);
  });

  it('throws a TypeError for a look-alike ParsedText, even one claiming ok: false', () => {
    const real = parseText('a: 1\n');
    expect(() => detectFormat({ ...real }, [make('x', true)])).toThrow(TypeError);
    expect(() => detectFormat({ ...real, ok: false }, [make('x', true)])).toThrow(TypeError);
  });

  it('registerFormat does not freeze a host format (P13)', () => {
    const f = make('host', true);
    registerFormat(f);
    expect(Object.isFrozen(f)).toBe(false);
    expect(getFormat('host')).toBe(f);
  });
});
