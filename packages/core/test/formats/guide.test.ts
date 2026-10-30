import { describe, expect, it } from 'vitest';
import { guideField, mergeGuide } from '../../src/formats/guide.js';
import type { Guide } from '../../src/formats/types.js';

const base: Guide = {
  groups: [
    { id: 'a', label: 'A', order: 2 },
    { id: 'b', label: 'B', order: 1 },
  ],
  kinds: { 'v1/Pod': { label: 'Pod', description: 'd', group: 'a' } },
  fields: { 'Pod#name': { label: 'Name', recommended: true } },
};

describe('mergeGuide', () => {
  it('overrides a field label but keeps recommended', () => {
    const snapshot = structuredClone(base);
    const m = mergeGuide(base, { fields: { 'Pod#name': { label: 'Title' }, 'Pod#x': { advanced: true } } });
    expect(m.fields['Pod#name']).toEqual({ label: 'Title', recommended: true });
    expect(m.fields['Pod#x']).toEqual({ advanced: true });
    expect(base).toEqual(snapshot);
  });

  it('merges kinds per field', () => {
    const m = mergeGuide(base, { kinds: { 'v1/Pod': { label: 'P2' } as never } });
    expect(m.kinds['v1/Pod']).toEqual({ label: 'P2', description: 'd', group: 'a' });
  });

  it('merges groups by id and keeps order', () => {
    const m = mergeGuide(base, {
      groups: [
        { id: 'a', label: 'A2', order: 0 },
        { id: 'c', label: 'C', order: 5 },
      ],
    });
    expect(m.groups).toEqual([
      { id: 'a', label: 'A2', order: 0 },
      { id: 'b', label: 'B', order: 1 },
      { id: 'c', label: 'C', order: 5 },
    ]);
    expect(base.groups[0]).toEqual({ id: 'a', label: 'A', order: 2 });
  });
});

describe('guideField', () => {
  it('looks up "<def>#<prop>"', () => {
    expect(guideField(base, 'Pod', 'name')?.label).toBe('Name');
    expect(guideField(base, 'Pod', 'nope')).toBeUndefined();
    expect(guideField(base, undefined, 'name')).toBeUndefined();
  });
});
