import { describe, expect, it } from 'vitest';
import { addableAt } from '../../src/engine/addable.js';
import { composeGuide } from '../../src/formats/compose/index.js';
import { loadComposeSchema } from '../../src/formats/compose/loader.js';
import { kubernetesGuide, loadKubernetesKind } from '../../src/formats/kubernetes/index.js';

const CONTAINER_PATH = ['spec', 'template', 'spec', 'containers', 0] as const;

describe('addableAt', () => {
  it('container (with name,image,ports,env present) starts with resources, readinessProbe, livenessProbe as recommended and excludes ports/env', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const data = {
      spec: { template: { spec: { containers: [{ name: 'a', image: 'b', ports: [], env: [] }] } } },
    };
    const items = addableAt(bundle, kubernetesGuide, CONTAINER_PATH, data);
    expect(items.slice(0, 3).map((i) => i.key)).toEqual(['resources', 'readinessProbe', 'livenessProbe']);
    expect(items.slice(0, 3).every((i) => i.tier === 'recommended')).toBe(true);
    const keys = items.map((i) => i.key);
    expect(keys).not.toContain('ports');
    expect(keys).not.toContain('env');
    expect(keys).not.toContain('name');
    expect(items[0]!.label).toBe('CPU & memory');
    expect(items[0]!.valueTemplate).toEqual({});
  });

  it('lists required-and-missing keys first', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const items = addableAt(bundle, kubernetesGuide, CONTAINER_PATH, {
      spec: { template: { spec: { containers: [{ image: 'b' }] } } },
    });
    expect(items[0]!.key).toBe('name');
    expect(items[0]!.required).toBe(true);
    expect(items[0]!.valueTemplate).toBe('');
  });

  it('compose services.web lists healthcheck as recommended', async () => {
    const bundle = await loadComposeSchema();
    const items = addableAt(bundle, composeGuide, ['services', 'web'], { services: { web: { image: 'nginx' } } });
    expect(items.find((i) => i.key === 'healthcheck')?.tier).toBe('recommended');
    expect(items[0]!.key).toBe('healthcheck');
    expect(items.map((i) => i.key)).not.toContain('image');
  });

  it('on a sequence returns one item with key null', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const data = { spec: { template: { spec: { containers: [] } } } };
    const items = addableAt(bundle, kubernetesGuide, ['spec', 'template', 'spec', 'containers'], data);
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBeNull();
    expect(items[0]!.valueTemplate).toEqual({});
  });

  it('returns [] for an unresolvable path', async () => {
    const bundle = (await loadKubernetesKind('v1', 'Service'))!;
    expect(addableAt(bundle, kubernetesGuide, ['zzz'], {})).toEqual([]);
  });
});
