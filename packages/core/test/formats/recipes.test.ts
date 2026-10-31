import { describe, expect, it } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { parseText } from '../../src/document/parse.js';
import { yamlDocs } from '../../src/document/internal.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { detectInputOf } from '../../src/formats/registry.js';
import type { Recipe } from '../../src/formats/types.js';
import { validateText } from '../../src/validation/validate.js';

const formats = [kubernetesFormat, composeFormat];
const all: Recipe[] = formats.flatMap((f) => [...(f.recipes ?? [])]);

describe('built-in recipes', () => {
  it('ship the documented ids', () => {
    expect(all.map((r) => r.id).sort()).toEqual(
      ['compose-app-postgres', 'compose-app-redis', 'compose-web-app', 'k8s-config', 'k8s-scheduled-job', 'k8s-web-app', 'k8s-worker'].sort(),
    );
  });

  it('every built-in recipe validates with zero problems', async () => {
    for (const r of all) {
      const format = formats.find((f) => f.id === r.format)!;
      const problems = await validateText(parseText(r.yaml), format);
      expect(problems, r.id).toEqual([]);
    }
  });

  it('every recipe is detected as its format', () => {
    for (const r of all) {
      const detected = formats.find((f) => f.detect(detectInputOf(parseText(r.yaml))));
      expect(detected?.id, r.id).toBe(r.format);
    }
  });

  it('every recipe is listed on its own format', () => {
    for (const f of formats) for (const r of f.recipes ?? []) expect(r.format).toBe(f.id);
  });

  it('every focus ref resolves to a scalar', () => {
    for (const r of all) {
      expect(r.focus, r.id).toBeDefined();
      expect(describeNode(parseText(r.yaml), r.focus!)?.type, r.id).toBe('scalar');
    }
  });

  it('recipe ids are unique', () => {
    const ids = all.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Kubernetes recipes refer to each other correctly', () => {
  type Obj = Record<string, any>;
  const docsOf = (r: Recipe): Obj[] => yamlDocs(parseText(r.yaml)).map((d) => d.toJS() as Obj);
  const isSubset = (small: Obj | undefined, big: Obj | undefined): boolean =>
    small !== undefined && Object.keys(small).length > 0 && Object.entries(small).every(([k, v]) => big?.[k] === v);
  const workloads = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet'];
  const k8s = kubernetesFormat.recipes!;
  const podLabels = (docs: Obj[]): Obj[] => docs.filter((d) => workloads.includes(d['kind'])).map((d) => d['spec']?.template?.metadata?.labels);

  it('each workload selector matches its own pod template labels', () => {
    const checked = k8s.flatMap((r) =>
      docsOf(r)
        .filter((d) => workloads.includes(d['kind']))
        .map((d) => [r.id, d['metadata'].name, isSubset(d['spec'].selector?.matchLabels, d['spec'].template?.metadata?.labels)]),
    );
    expect(checked.length).toBeGreaterThan(0);
    for (const [id, name, ok] of checked) expect(ok, `${id} ${name}`).toBe(true);
  });

  it('each Service selects the pods of a workload in the same recipe', () => {
    const checked = k8s.flatMap((r) => {
      const docs = docsOf(r);
      return docs.filter((d) => d['kind'] === 'Service').map((s) => [r.id, s['metadata'].name, podLabels(docs).some((l) => isSubset(s['spec'].selector, l))]);
    });
    expect(checked.length).toBeGreaterThan(0);
    for (const [id, name, ok] of checked) expect(ok, `${id} ${name}`).toBe(true);
  });

  it('each Ingress backend names a Service in the same recipe', () => {
    const checked = k8s.flatMap((r) => {
      const docs = docsOf(r);
      const services = new Set(docs.filter((d) => d['kind'] === 'Service').map((d) => d['metadata'].name));
      return docs
        .filter((d) => d['kind'] === 'Ingress')
        .flatMap((ing) => (ing['spec'].rules ?? []).flatMap((rule: Obj) => rule['http']?.paths ?? []))
        .map((p: Obj) => [r.id, p['backend']?.service?.name, services.has(p['backend']?.service?.name)]);
    });
    expect(checked.length).toBeGreaterThan(0);
    for (const [id, name, ok] of checked) expect(ok, `${id} ${name}`).toBe(true);
  });
});
