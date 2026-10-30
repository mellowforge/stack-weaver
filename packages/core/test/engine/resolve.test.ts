import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { resolveAt } from '../../src/engine/resolve.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';

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

const bundleOf = (schema: Record<string, unknown>) => ({ id: 't', schema, validate: () => [] });

describe('resolveAt branches (inline schemas)', () => {
  const objDefs = { obj: { type: 'object', properties: { a: { type: 'string' } } } };
  const union = bundleOf({
    type: 'object',
    properties: { v: { anyOf: [{ type: 'string' }, { $ref: '#/$defs/obj' }] } },
    $defs: objDefs,
  });

  it('picks the anyOf branch matching string data', () => {
    const r = resolveAt(union, ['v'], { v: 'x' });
    expect(r?.schema.type).toBe('string');
    expect(r?.schema.properties).toBeUndefined();
  });

  it('picks the anyOf branch matching object data', () => {
    const r = resolveAt(union, ['v'], { v: { a: 'x' } });
    expect(r?.schema.type).toBe('object');
    expect(r?.defName).toBe('obj');
  });

  it('prefers the first non-null object branch for null or missing data', () => {
    const b = bundleOf({
      type: 'object',
      properties: { v: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/obj' }] } },
      $defs: objDefs,
    });
    for (const data of [{ v: null }, {}]) {
      const r = resolveAt(b, ['v'], data);
      expect(r?.defName).toBe('obj');
      expect(Object.keys(r?.schema.properties as object)).toEqual(['a']);
    }
  });

  it('uses properties, then patternProperties, then additionalProperties', () => {
    const b = bundleOf({
      type: 'object',
      properties: { exact: { type: 'integer' } },
      patternProperties: { '^x-': { type: 'boolean' }, '^exact$': { type: 'null' } },
      additionalProperties: { type: 'string' },
    });
    expect(resolveAt(b, ['exact'], {})?.schema.type).toBe('integer');
    expect(resolveAt(b, ['x-foo'], {})?.schema.type).toBe('boolean');
    expect(resolveAt(b, ['other'], {})?.schema.type).toBe('string');
  });

  it('terminates on a directly self-referencing $ref', () => {
    const b = bundleOf({ $ref: '#/$defs/a', $defs: { a: { $ref: '#/$defs/a' } } });
    expect(resolveAt(b, [], {})).toBeUndefined();
  });

  it('terminates on a self-referencing $ref through allOf', () => {
    const b = bundleOf({
      $ref: '#/$defs/a',
      $defs: { a: { type: 'object', allOf: [{ $ref: '#/$defs/a' }], properties: { p: { type: 'string' } } } },
    });
    const r = resolveAt(b, [], {});
    expect(r === undefined || r.defName === 'a').toBe(true);
    expect(resolveAt(b, ['p'], {})?.schema.type).toBe('string');
  });

  it('terminates on a recursive property type', () => {
    const b = bundleOf({
      $ref: '#/$defs/n',
      $defs: { n: { type: 'object', properties: { next: { $ref: '#/$defs/n' } } } },
    });
    expect(resolveAt(b, ['next', 'next', 'next'], {})?.defName).toBe('n');
  });
});
