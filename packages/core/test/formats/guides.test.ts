import { describe, expect, it } from 'vitest';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { kubernetesKinds, loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { JsonSchema } from '../../src/formats/types.js';

interface Def {
  properties?: Record<string, unknown>;
  allOf?: { $ref?: string }[];
}

/** True when `def` declares `prop`, directly or through `allOf` `$ref`s into `defs` (compose's `service`). */
function hasProp(def: unknown, prop: string, defs: Record<string, unknown> = {}): boolean {
  const d = def as Def | undefined;
  if (d?.properties !== undefined && prop in d.properties) return true;
  return (d?.allOf ?? []).some((a) => a.$ref !== undefined && hasProp(defs[a.$ref.replace('#/$defs/', '')], prop, defs));
}

describe('kubernetes guide', () => {
  const guide = kubernetesFormat.guide;

  it('every guide kind exists in kubernetesKinds()', () => {
    const known = new Set(kubernetesKinds().map((k) => `${k.apiVersion}/${k.kind}`));
    for (const key of Object.keys(guide.kinds)) expect(known.has(key), key).toBe(true);
    expect(Object.keys(guide.kinds)).toHaveLength(10);
  });

  it('every guide kind belongs to a declared group', () => {
    const groups = new Set(guide.groups.map((g) => g.id));
    for (const [key, k] of Object.entries(guide.kinds)) expect(groups.has(k.group), key).toBe(true);
  });

  it('every guide field "<def>#<prop>" exists in some loaded kind', async () => {
    const kinds = kubernetesKinds();
    const bundles = await Promise.all(kinds.map((k) => loadKubernetesKind(k.apiVersion, k.kind)));
    const defs = new Map<string, unknown>();
    kinds.forEach((k, i) => {
      const schema = bundles[i]?.schema as JsonSchema;
      for (const [n, d] of Object.entries((schema.$defs ?? {}) as Record<string, unknown>)) defs.set(n, d);
      if (!defs.has(k.defName)) defs.set(k.defName, schema);
    });
    expect(Object.keys(guide.fields).length).toBeGreaterThan(0);
    for (const key of Object.keys(guide.fields)) {
      const [def, prop] = key.split('#') as [string, string];
      expect(hasProp(defs.get(def), prop), key).toBe(true);
    }
  });
});

describe('compose guide', () => {
  const guide = composeFormat.guide;

  it('has no kinds and a services group', () => {
    expect(Object.keys(guide.kinds)).toEqual([]);
    expect(guide.groups.map((g) => g.id)).toEqual(['services']);
  });

  it('every guide field exists in the compose schema', async () => {
    const bundle = await composeFormat.loadSchema(undefined as never, 0);
    const defs = (bundle?.schema.$defs ?? {}) as Record<string, unknown>;
    expect(Object.keys(guide.fields).length).toBeGreaterThan(0);
    for (const key of Object.keys(guide.fields)) {
      const [def, prop] = key.split('#') as [string, string];
      expect(hasProp(defs[def], prop, defs), key).toBe(true);
    }
  });
});

describe('freezing', () => {
  it('formats and guides are frozen', () => {
    for (const f of [kubernetesFormat, composeFormat]) {
      expect(Object.isFrozen(f)).toBe(true);
      expect(Object.isFrozen(f.guide)).toBe(true);
      expect(Object.isFrozen(f.guide.fields)).toBe(true);
      expect(Object.isFrozen(Object.values(f.guide.fields)[0])).toBe(true);
    }
  });

  it('bundle schema is frozen and validation still works', async () => {
    const bundle = (await loadKubernetesKind('v1', 'Service'))!;
    expect(Object.isFrozen(bundle.schema)).toBe(true);
    expect(Object.isFrozen((bundle.schema as { $defs: object }).$defs)).toBe(true);
    expect(Array.isArray(bundle.validate({ apiVersion: 'v1', kind: 'Service' }))).toBe(true);
  });

  it('subpaths export only the format', async () => {
    expect(Object.keys(await import('../../src/formats/kubernetes/index.js'))).toEqual(['kubernetesFormat']);
    expect(Object.keys(await import('../../src/formats/compose/index.js'))).toEqual(['composeFormat']);
  });
});
