import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { resolveAt } from '../../src/engine/resolve.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/index.js';

const k8s = (name: string, doc = 0) =>
  parseText(readFileSync(new URL(`../fixtures/corpus/${name}`, import.meta.url), 'utf8')).docs[doc]!.toJS() as unknown;

describe('resolveAt', () => {
  it('Deployment containers[0] gives defName io.k8s.api.core.v1.Container', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const data = k8s('k8s-web-app.yaml', 0);
    const r = resolveAt(bundle, ['spec', 'template', 'spec', 'containers', 0], data);
    expect(r?.defName).toBe('io.k8s.api.core.v1.Container');
    expect(r?.required).toContain('name');
  });

  it('metadata.labels.app gives string via additionalProperties', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const r = resolveAt(bundle, ['metadata', 'labels', 'app'], k8s('k8s-web-app.yaml', 0));
    expect(r?.schema.type).toBe('string');
  });

  it('targetPort gives int-or-string anyOf', async () => {
    const bundle = (await loadKubernetesKind('v1', 'Service'))!;
    const r = resolveAt(bundle, ['spec', 'ports', 0, 'targetPort'], k8s('k8s-web-app.yaml', 1));
    expect(r?.schema.anyOf).toEqual([{ type: 'integer' }, { type: 'string' }]);
  });

  it('returns undefined when nothing resolves', async () => {
    const bundle = (await loadKubernetesKind('v1', 'Service'))!;
    expect(resolveAt(bundle, ['spec', 'nope'], {})).toBeUndefined();
  });
});
