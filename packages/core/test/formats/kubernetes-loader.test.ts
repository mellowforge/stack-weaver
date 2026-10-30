import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { kubernetesKinds, loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';

const webApp = parseText(readFileSync(new URL('../fixtures/corpus/k8s-web-app.yaml', import.meta.url), 'utf8'));
const doc = (i: number) => webApp.docs[i]!.toJS() as Record<string, unknown>;

describe('kubernetesKinds', () => {
  it('kinds include apps/v1 Deployment, v1 Service, networking.k8s.io/v1 Ingress, autoscaling/v2 HPA; exclude *List and v1beta1', () => {
    const kinds = kubernetesKinds();
    const has = (apiVersion: string, kind: string) => kinds.some((k) => k.apiVersion === apiVersion && k.kind === kind);
    expect(has('apps/v1', 'Deployment')).toBe(true);
    expect(has('v1', 'Service')).toBe(true);
    expect(has('networking.k8s.io/v1', 'Ingress')).toBe(true);
    expect(has('autoscaling/v2', 'HorizontalPodAutoscaler')).toBe(true);
    expect(kinds.some((k) => k.kind.endsWith('List'))).toBe(false);
    expect(kinds.some((k) => /alpha|beta/.test(k.apiVersion))).toBe(false);
    expect(kinds.some((k) => k.defName.startsWith('io.k8s.apimachinery.pkg.apis.meta'))).toBe(false);

    const dep = kinds.find((k) => k.id === 'apps_v1_Deployment');
    expect(dep).toMatchObject({ apiVersion: 'apps/v1', kind: 'Deployment', defName: 'io.k8s.api.apps.v1.Deployment' });
    expect(dep!.description).toMatch(/Deployment/);
    expect(kinds.find((k) => k.id === 'core_v1_Service')?.apiVersion).toBe('v1');
  });
});

describe('loadKubernetesKind', () => {
  it("loadKubernetesKind('apps/v1','Deployment') validates the web-app fixture doc 0 with []", async () => {
    const bundle = await loadKubernetesKind('apps/v1', 'Deployment');
    expect(bundle).toBeDefined();
    expect(bundle!.id).toBe('apps_v1_Deployment');
    expect(bundle!.schema.$defs).toHaveProperty(['io.k8s.api.core.v1.PodSpec']);
    expect(bundle!.validate(doc(0))).toEqual([]);
  });

  it('validates the Service and Ingress docs too', async () => {
    expect((await loadKubernetesKind('v1', 'Service'))!.validate(doc(1))).toEqual([]);
    expect((await loadKubernetesKind('networking.k8s.io/v1', 'Ingress'))!.validate(doc(2))).toEqual([]);
  });

  it('replicas: "three" yields a SchemaError at /spec/replicas keyword type', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const bad = doc(0);
    (bad.spec as Record<string, unknown>).replicas = 'three';
    const errors = bundle.validate(bad);
    expect(errors).toContainEqual(expect.objectContaining({ instancePath: '/spec/replicas', keyword: 'type' }));
    // A later valid call is unaffected by the earlier errors.
    expect(bundle.validate(doc(0))).toEqual([]);
  });

  it('enforces the kind root constants and required metadata', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const { metadata: _m, ...noMeta } = doc(0);
    expect(bundle.validate(noMeta)).toContainEqual(expect.objectContaining({ keyword: 'required', params: { missingProperty: 'metadata' } }));
    expect(bundle.validate({ ...doc(0), kind: 'Service' })).toContainEqual(
      expect.objectContaining({ instancePath: '/kind', keyword: 'const' }),
    );
  });

  it('validates every corpus document of a known kind with [] (embedded kinds such as PVC templates stay unrooted)', async () => {
    const dir = new URL('../fixtures/corpus/', import.meta.url);
    let checked = 0;
    for (const file of readdirSync(dir).filter((f) => f.startsWith('k8s-'))) {
      for (const d of parseText(readFileSync(new URL(file, dir), 'utf8')).docs) {
        const data = d.toJS() as { apiVersion?: string; kind?: string } | null;
        if (!data?.apiVersion || !data.kind) continue;
        const bundle = await loadKubernetesKind(data.apiVersion, data.kind);
        if (!bundle) continue;
        expect([file, data.kind, bundle.validate(data)]).toEqual([file, data.kind, []]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('caches bundles per id', async () => {
    expect(await loadKubernetesKind('apps/v1', 'Deployment')).toBe(await loadKubernetesKind('apps/v1', 'Deployment'));
  });

  it('unknown kind returns undefined', async () => {
    expect(await loadKubernetesKind('example.com/v1', 'Widget')).toBeUndefined();
    expect(await loadKubernetesKind('apps/v1', 'DeploymentList')).toBeUndefined();
  });
});
