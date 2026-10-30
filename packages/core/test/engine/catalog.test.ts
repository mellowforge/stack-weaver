import { describe, expect, it } from 'vitest';
import { kindCatalog } from '../../src/engine/catalog.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';

describe('kindCatalog', () => {
  it('kubernetes: groups in order run, expose, configure, scale, storage; Service in expose', () => {
    const { curated } = kindCatalog(kubernetesFormat);
    expect(curated.map((g) => g.id)).toEqual(['run', 'expose', 'configure', 'scale', 'storage']);
    const expose = curated.find((g) => g.id === 'expose')!;
    const svc = expose.kinds.find((k) => k.kind === 'Service' && k.apiVersion === 'v1');
    expect(svc?.label).toBe('Service');
    expect(svc?.description).toBe('Stable network address for your pods');
    expect(curated[0]!.kinds.map((k) => k.kind)).toEqual(['Deployment', 'StatefulSet', 'Job', 'CronJob']);
  });

  it('all contains uncurated kinds like v1 ServiceAccount', () => {
    const { all } = kindCatalog(kubernetesFormat);
    expect(all.some((k) => k.apiVersion === 'v1' && k.kind === 'ServiceAccount')).toBe(true);
  });

  it('compose has no kinds and so no curated groups', () => {
    expect(kindCatalog(composeFormat)).toEqual({ curated: [], all: [] });
  });
});
