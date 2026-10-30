import { describe, expect, it } from 'vitest';
import { kindCatalog } from '../../src/engine/catalog.js';
import { kubernetesGuide } from '../../src/formats/kubernetes/guide.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { guideField, kindKey, mergeGuide } from '../../src/formats/guide.js';
import type { Guide } from '../../src/formats/types.js';

const base: Guide = {
  groups: [
    { id: 'a', label: 'A', order: 2 },
    { id: 'b', label: 'B', order: 1 },
  ],
  kinds: { 'v1/Pod': { label: 'Pod', description: 'd', group: 'a' } },
  fields: { 'Pod#name': { label: 'Name', tier: 'recommended' } },
};

describe('mergeGuide', () => {
  it('overrides a field label but keeps tier', () => {
    const snapshot = structuredClone(base);
    const m = mergeGuide(base, { fields: { 'Pod#name': { label: 'Title' }, 'Pod#x': { tier: 'advanced' } } });
    expect(m.fields['Pod#name']).toEqual({ label: 'Title', tier: 'recommended' });
    expect(m.fields['Pod#x']).toEqual({ tier: 'advanced' });
    expect(base).toEqual(snapshot);
  });

  it('merges kinds per field', () => {
    const m = mergeGuide(base, { kinds: { 'v1/Pod': { label: 'P2' } } });
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

describe('mergeGuide (hardening)', () => {
  it('drops incomplete kinds', () => {
    const m = mergeGuide(base, { kinds: { 'x/v1/Foo': { label: 'Foo' } } });
    expect('x/v1/Foo' in m.kinds).toBe(false);
    expect(m.kinds['v1/Pod']).toBeDefined();
  });

  it('keeps a complete new kind and works on a frozen base', () => {
    const m = mergeGuide(kubernetesGuide, { kinds: { 'x/v1/Foo': { label: 'Foo', description: 'd', group: 'run' } } });
    expect(m.kinds['x/v1/Foo']?.label).toBe('Foo');
    expect(Object.isFrozen(kubernetesGuide)).toBe(true);
  });

  it('overrides one field key', () => {
    const m = mergeGuide(base, { fields: { 'Pod#name': { order: 9 } } });
    expect(m.fields['Pod#name']).toEqual({ label: 'Name', tier: 'recommended', order: 9 });
  });
});

describe('kindKey', () => {
  it('formats apiVersion/kind', () => {
    expect(kindKey('apps/v1', 'Deployment')).toBe('apps/v1/Deployment');
  });
  it('matches catalog keys', () => {
    for (const g of kindCatalog(kubernetesFormat).curated)
      for (const k of g.kinds) expect(kindKey(k.apiVersion, k.kind) in kubernetesGuide.kinds).toBe(true);
  });
});
