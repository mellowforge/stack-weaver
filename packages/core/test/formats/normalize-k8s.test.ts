import { describe, expect, it } from 'vitest';
import { collectReachable, normalizeK8s, QUANTITY_PATTERN } from '../../scripts/lib/normalize-k8s.mjs';

const Q = 'io.k8s.apimachinery.pkg.api.resource.Quantity';

describe('normalizeK8s', () => {
  it('ref rewrite', () => {
    const out = normalizeK8s({
      A: { type: 'object', properties: { b: { allOf: [{ $ref: '#/components/schemas/B' }] } } },
      B: { type: 'string' },
    });
    expect(out.A).toEqual({ type: 'object', properties: { b: { allOf: [{ $ref: '#/$defs/B' }] } } });
  });

  it('int-or-string', () => {
    const out = normalizeK8s({
      IntOrString: { description: 'int or string', format: 'int-or-string', oneOf: [{ type: 'integer' }, { type: 'string' }] },
      Other: {
        type: 'object',
        properties: { port: { description: 'p', type: 'string', 'x-kubernetes-int-or-string': true } },
      },
    });
    expect(out.IntOrString).toEqual({ description: 'int or string', anyOf: [{ type: 'integer' }, { type: 'string' }] });
    expect(out.Other).toEqual({
      type: 'object',
      properties: { port: { description: 'p', anyOf: [{ type: 'integer' }, { type: 'string' }] } },
    });
  });

  it('quantity', () => {
    const out = normalizeK8s({ [Q]: { description: 'qty', oneOf: [{ type: 'string' }, { type: 'number' }] } });
    expect(out[Q]).toEqual({ description: 'qty', anyOf: [{ type: 'string', pattern: QUANTITY_PATTERN }, { type: 'number' }] });
    expect(QUANTITY_PATTERN).toBe('^[+-]?([0-9]+(\\.[0-9]*)?|\\.[0-9]+)([eE][+-]?[0-9]+|[numkMGTPE]i?|[KMGTPE]i)?$');
    const re = new RegExp(QUANTITY_PATTERN);
    for (const ok of ['500m', '256Mi', '1', '1.5', '+2Gi', '1e3', '.5']) expect(re.test(ok), ok).toBe(true);
    for (const bad of ['', 'abc', '1 Gi', '5mb', '1Ki2']) expect(re.test(bad), bad).toBe(false);
  });

  it('nullable', () => {
    const out = normalizeK8s({
      A: { type: 'string', nullable: true },
      B: { type: ['string', 'integer'], nullable: true },
      C: { nullable: false, type: 'string' },
    });
    expect(out.A).toEqual({ type: ['string', 'null'] });
    expect(out.B).toEqual({ type: ['string', 'integer', 'null'] });
    expect(out.C).toEqual({ type: 'string' });
  });

  it('Time definition accepts null (kubectl exports creationTimestamp: null)', () => {
    const out = normalizeK8s({ 'io.k8s.apimachinery.pkg.apis.meta.v1.Time': { type: 'string', format: 'date-time' } });
    expect(out['io.k8s.apimachinery.pkg.apis.meta.v1.Time']).toEqual({ type: ['string', 'null'], format: 'date-time' });
  });

  it('drops x-kubernetes-* keys except group-version-kind', () => {
    const gvk = [{ group: 'apps', version: 'v1', kind: 'Thing' }];
    const out = normalizeK8s({
      T: {
        type: 'object',
        'x-kubernetes-group-version-kind': gvk,
        'x-kubernetes-unions': [{ discriminator: 'type' }],
        properties: { l: { type: 'array', 'x-kubernetes-list-type': 'map', items: { type: 'string' } } },
      },
    }, { kindRoots: false });
    expect(out.T).toEqual({
      type: 'object',
      'x-kubernetes-group-version-kind': gvk,
      properties: { l: { type: 'array', items: { type: 'string' } } },
    });
  });

  it('kind root consts and required', () => {
    const out = normalizeK8s({
      'io.k8s.api.apps.v1.Thing': {
        type: 'object',
        required: ['spec'],
        properties: {
          apiVersion: { description: 'api version', type: 'string' },
          kind: { description: 'kind', type: 'string' },
          metadata: { allOf: [{ $ref: '#/components/schemas/Meta' }] },
          spec: { type: 'object' },
        },
        'x-kubernetes-group-version-kind': [{ group: 'apps', version: 'v1', kind: 'Thing' }],
      },
      'io.k8s.api.core.v1.Other': {
        type: 'object',
        properties: { apiVersion: { type: 'string' }, kind: { type: 'string' } },
        'x-kubernetes-group-version-kind': [{ group: '', version: 'v1', kind: 'Other' }],
      },
      Meta: { type: 'object' },
    });
    const root = out['io.k8s.api.apps.v1.Thing'] as { properties: Record<string, unknown>; required: string[] };
    expect(root.properties.apiVersion).toEqual({ description: 'api version', type: 'string', const: 'apps/v1' });
    expect(root.properties.kind).toEqual({ description: 'kind', type: 'string', const: 'Thing' });
    expect(root.required).toEqual(['spec', 'apiVersion', 'kind', 'metadata']);
    const other = out['io.k8s.api.core.v1.Other'] as { properties: Record<string, unknown>; required: string[] };
    expect(other.properties.apiVersion).toEqual({ type: 'string', const: 'v1' });
    expect(other.required).toEqual(['apiVersion', 'kind', 'metadata']);
    expect(out.Meta).toEqual({ type: 'object' });
  });

  it('treats property names and data values as data, not schema keywords', () => {
    const props = {
      nullable: { type: 'boolean' },
      format: { type: 'string' },
      'x-kubernetes-int-or-string': { type: 'boolean' },
    };
    const out = normalizeK8s({
      JSONSchemaProps: { type: 'object', properties: props, default: { $ref: '#/components/schemas/X', nullable: true } },
    });
    expect(out.JSONSchemaProps).toEqual({
      type: 'object',
      properties: props,
      default: { $ref: '#/components/schemas/X', nullable: true },
    });
  });

  it('skips rule 6 with kindRoots: false', () => {
    const def = {
      type: 'object',
      properties: { kind: { type: 'string' } },
      'x-kubernetes-group-version-kind': [{ group: '', version: 'v1', kind: 'PersistentVolumeClaim' }],
    };
    expect(normalizeK8s({ 'io.k8s.api.core.v1.PersistentVolumeClaim': def }, { kindRoots: false })).toEqual({
      'io.k8s.api.core.v1.PersistentVolumeClaim': def,
    });
  });

  it('does not mutate its input', () => {
    const input = { A: { type: 'string', nullable: true, $ref: '#/components/schemas/B' }, B: { type: 'string' } };
    const snapshot = structuredClone(input);
    normalizeK8s(input);
    expect(input).toEqual(snapshot);
  });
});

describe('collectReachable', () => {
  it('collectReachable includes PodSpec for Deployment', () => {
    const r = (n: string) => ({ allOf: [{ $ref: `#/$defs/${n}` }] });
    const defs = {
      Deployment: { type: 'object', properties: { metadata: r('ObjectMeta'), spec: r('DeploymentSpec') } },
      DeploymentSpec: { type: 'object', properties: { template: r('PodTemplateSpec') } },
      PodTemplateSpec: { type: 'object', properties: { spec: r('PodSpec') } },
      PodSpec: { type: 'object', properties: { containers: { type: 'array', items: r('Container') } } },
      Container: { type: 'object', properties: { self: r('Container') } },
      ObjectMeta: { type: 'object' },
      Service: { type: 'object', properties: { spec: r('ServiceSpec') } },
      ServiceSpec: { type: 'object' },
    };
    const out = collectReachable(defs, 'Deployment');
    expect(Object.keys(out).sort()).toEqual(
      ['Container', 'Deployment', 'DeploymentSpec', 'ObjectMeta', 'PodSpec', 'PodTemplateSpec'].sort(),
    );
    expect(out.PodSpec).toBe(defs.PodSpec);
  });

  it('throws on a dangling $ref', () => {
    expect(() => collectReachable({ A: { $ref: '#/$defs/Missing' } }, 'A')).toThrow(/Missing/);
  });
});
