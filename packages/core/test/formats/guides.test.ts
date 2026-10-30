import { describe, expect, it } from 'vitest';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { kubernetesKinds, loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { Guide, JsonSchema } from '../../src/formats/types.js';
import { defaultWidgets } from '../../src/visual/widgets/registry.js';

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

const OPTIONS_KEYS: Record<string, readonly string[]> = {
  'io.k8s.api.core.v1.Container#imagePullPolicy': ['Always', 'IfNotPresent', 'Never'],
  'io.k8s.api.core.v1.PodSpec#restartPolicy': ['Always', 'OnFailure', 'Never'],
  'io.k8s.api.core.v1.ServiceSpec#type': ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'],
  'io.k8s.api.core.v1.ContainerPort#protocol': ['TCP', 'UDP', 'SCTP'],
  'io.k8s.api.core.v1.ServicePort#protocol': ['TCP', 'UDP', 'SCTP'],
  'io.k8s.api.core.v1.PersistentVolumeClaimSpec#accessModes': ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'],
  'io.k8s.api.apps.v1.DeploymentStrategy#type': ['RollingUpdate', 'Recreate'],
  'io.k8s.api.batch.v1.CronJobSpec#concurrencyPolicy': ['Allow', 'Forbid', 'Replace'],
  'io.k8s.api.networking.v1.HTTPIngressPath#pathType': ['Prefix', 'Exact', 'ImplementationSpecific'],
  'service#restart': ['no', 'always', 'on-failure', 'unless-stopped'],
};

async function allDefs(): Promise<{ k8s: Map<string, unknown>; compose: Record<string, unknown> }> {
  const k8s = new Map<string, unknown>();
  for (const k of kubernetesKinds()) {
    const schema = (await loadKubernetesKind(k.apiVersion, k.kind))!.schema as JsonSchema;
    for (const [n, d] of Object.entries((schema.$defs ?? {}) as Record<string, unknown>)) k8s.set(n, d);
    if (!k8s.has(k.defName)) k8s.set(k.defName, schema);
  }
  const compose = ((await composeFormat.loadSchema(undefined as never, 0))?.schema.$defs ?? {}) as Record<string, unknown>;
  return { k8s, compose };
}

const fieldsOf = (g: Guide): [string, string, string][] => Object.keys(g.fields).map((k) => [k, ...(k.split('#') as [string, string])]);

describe('curated guide data', () => {
  it('every curated field key exists in the schema', async () => {
    const { k8s, compose } = await allDefs();
    expect(Object.keys(kubernetesFormat.guide.fields).length).toBeGreaterThan(40);
    expect(Object.keys(composeFormat.guide.fields).length).toBeGreaterThan(12);
    for (const [key, def, prop] of fieldsOf(kubernetesFormat.guide)) expect(hasProp(k8s.get(def), prop), key).toBe(true);
    for (const [key, def, prop] of fieldsOf(composeFormat.guide)) expect(hasProp(compose[def], prop, compose), key).toBe(true);
  });

  it('every v1 curated kind has at least one recommended field', async () => {
    const { k8s, compose } = await allDefs();
    const recommended = (def: string): boolean => Object.entries(kubernetesFormat.guide.fields).some(([k, f]) => k.startsWith(`${def}#`) && f.tier === 'recommended');
    const specOf = (def: string): string | undefined => {
      const ref = (k8s.get(def) as { properties?: { spec?: { $ref?: string; allOf?: { $ref?: string }[] } } }).properties?.spec;
      return (ref?.$ref ?? ref?.allOf?.[0]?.$ref)?.replace('#/$defs/', '');
    };
    const kinds = kubernetesKinds().filter((k) => `${k.apiVersion}/${k.kind}` in kubernetesFormat.guide.kinds);
    expect(kinds).toHaveLength(10);
    for (const k of kinds) {
      const spec = specOf(k.defName);
      expect(recommended(k.defName) || (spec !== undefined && recommended(spec)), k.kind).toBe(true);
    }
    for (const def of ['service', 'network', 'volume', 'config', 'secret']) {
      expect(compose[def], def).toBeDefined();
      expect(Object.entries(composeFormat.guide.fields).some(([k, f]) => k.startsWith(`${def}#`) && f.tier === 'recommended'), def).toBe(true);
    }
  });

  it('every guide widget name is in defaultWidgets', () => {
    for (const g of [kubernetesFormat.guide, composeFormat.guide]) {
      for (const [key, f] of Object.entries(g.fields)) {
        if (f.widget === undefined) continue;
        expect(Object.keys(defaultWidgets), key).toContain(f.widget.split(':')[0]);
      }
    }
    for (const name of ['ref', 'ref-key', 'secret-data', 'suggest']) expect(Object.keys(defaultWidgets)).toContain(name);
  });

  it('reference and Secret data widgets are curated as the brief says', () => {
    const f = kubernetesFormat.guide.fields;
    const v1 = 'io.k8s.api.core.v1.';
    expect(f[`${v1}SecretKeySelector#name`]?.widget).toBe('ref:Secret');
    expect(f[`${v1}SecretEnvSource#name`]?.widget).toBe('ref:Secret');
    expect(f[`${v1}SecretVolumeSource#secretName`]?.widget).toBe('ref:Secret');
    expect(f[`${v1}ConfigMapKeySelector#name`]?.widget).toBe('ref:ConfigMap');
    expect(f[`${v1}ConfigMapEnvSource#name`]?.widget).toBe('ref:ConfigMap');
    expect(f[`${v1}ConfigMapVolumeSource#name`]?.widget).toBe('ref:ConfigMap');
    expect(f[`${v1}SecretKeySelector#key`]?.widget).toBe('ref-key:Secret');
    expect(f[`${v1}ConfigMapKeySelector#key`]?.widget).toBe('ref-key:ConfigMap');
    expect(f[`${v1}Secret#data`]?.widget).toBe('secret-data');
    expect(f[`${v1}Secret#stringData`]?.tier).toBe('recommended');
  });

  it('every options key is curated, exists in the schema, and lists the closed set', async () => {
    const { k8s, compose } = await allDefs();
    for (const [key, values] of Object.entries(OPTIONS_KEYS)) {
      const field = key.startsWith('service#') ? composeFormat.guide.fields[key] : kubernetesFormat.guide.fields[key];
      expect(field?.options, key).toEqual(values);
      const [def, prop] = key.split('#') as [string, string];
      expect(hasProp(def === 'service' ? compose[def] : k8s.get(def), prop, compose), key).toBe(true);
    }
    for (const g of [kubernetesFormat.guide, composeFormat.guide]) {
      for (const [key, f] of Object.entries(g.fields)) if (f.options) expect(Object.keys(OPTIONS_KEYS), key).toContain(key);
    }
  });
});
