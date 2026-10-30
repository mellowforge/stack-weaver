import { describe, expect, it } from 'vitest';
import { addableAt, valueTemplateAt } from '../../src/engine/addable.js';
import { composeGuide } from '../../src/formats/compose/guide.js';
import { loadComposeSchema } from '../../src/formats/compose/loader.js';
import { kubernetesGuide } from '../../src/formats/kubernetes/guide.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { Guide, SchemaBundle } from '../../src/formats/types.js';

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

const bundleOf = (schema: Record<string, unknown>): SchemaBundle => ({ id: 't', schema, validate: () => [] });
const guideOf = (fields: Guide['fields']): Guide => ({ groups: [], kinds: {}, fields });
/** Wraps `props` in a `$ref`'d definition `D` so guide keys are `D#<prop>`. */
const withDef = (def: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  bundleOf({ $ref: '#/$defs/D', $defs: { D: { type: 'object', ...def }, ...extra } });

describe('addableAt branches (inline schemas)', () => {
  it('excludes keys the guide marks hidden', () => {
    const b = withDef({ properties: { a: {}, b: {} } });
    expect(addableAt(b, guideOf({}), [], {}).map((i) => i.key)).toEqual(['a', 'b']);
    expect(addableAt(b, guideOf({ 'D#a': { hidden: true } }), [], {}).map((i) => i.key)).toEqual(['b']);
  });

  it('falls back to the declaring member definition for guide lookup', () => {
    const b = bundleOf({
      $ref: '#/$defs/S',
      $defs: {
        S: { allOf: [{ $ref: '#/$defs/M' }] },
        M: { type: 'object', properties: { a: {}, b: {} } },
      },
    });
    const items = addableAt(b, guideOf({ 'M#a': { hidden: true }, 'M#b': { label: 'Bee' } }), [], {});
    expect(items.map((i) => [i.key, i.label])).toEqual([['b', 'Bee']]);
  });

  it('description: first sentence, then wrapper description, then referenced def description', () => {
    const b = withDef(
      {
        properties: {
          plain: { type: 'string', description: 'First one. Second one.' },
          wrapped: { allOf: [{ $ref: '#/$defs/R' }], description: 'Wrapper text. More.' },
          viaRef: { allOf: [{ $ref: '#/$defs/R' }] },
          none: { type: 'string' },
        },
      },
      { R: { type: 'object', description: 'Ref text. Extra.' } },
    );
    const byKey = Object.fromEntries(addableAt(b, guideOf({}), [], {}).map((i) => [i.key, i.description]));
    expect(byKey).toEqual({ plain: 'First one.', wrapped: 'Wrapper text.', viaRef: 'Ref text.', none: '' });
  });

  it('guide description overrides the schema description', () => {
    const b = withDef({ properties: { a: { type: 'string', description: 'Schema.' } } });
    expect(addableAt(b, guideOf({ 'D#a': { description: 'Guide.' } }), [], {})[0]!.description).toBe('Guide.');
  });

  it('valueTemplate: guide example first, then type defaults', () => {
    const b = withDef({
      properties: {
        ex: { type: 'string' },
        o: { type: 'object' },
        arr: { type: 'array' },
        s: { type: 'string' },
        i: { type: 'integer' },
        n: { type: 'number' },
        bo: { type: 'boolean' },
        ios: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        weird: { enum: [1, 2] },
        nullableObj: { type: ['object', 'null'] },
      },
    });
    const items = addableAt(b, guideOf({ 'D#ex': { example: 'nginx' } }), [], {});
    const t = Object.fromEntries(items.map((i) => [i.key, i.valueTemplate]));
    expect(t).toEqual({ ex: 'nginx', o: {}, arr: [], s: '', i: 0, n: 0, bo: false, ios: '', weird: null, nullableObj: {} });
  });

  it('orders: required first, then recommended/common/advanced, then guide order, then name', () => {
    const b = withDef({
      required: ['reqAdv', 'reqRec'],
      properties: Object.fromEntries(
        ['reqAdv', 'reqRec', 'recB', 'recA', 'recOrd', 'comB', 'comA', 'comOrd', 'advB', 'advA'].map((k) => [k, {}]),
      ),
    });
    const g = guideOf({
      'D#reqRec': { tier: 'recommended' },
      'D#recB': { tier: 'recommended' },
      'D#recA': { tier: 'recommended' },
      'D#recOrd': { tier: 'recommended', order: 1 },
      'D#comB': {},
      'D#comA': {},
      'D#comOrd': { order: 2 },
    });
    expect(addableAt(b, g, [], {}).map((i) => i.key)).toEqual([
      'reqRec', 'reqAdv',
      'recOrd', 'recA', 'recB',
      'comOrd', 'comA', 'comB',
      'advA', 'advB',
    ]);
  });
});

describe('tier drives ranking', () => {
  const schema = {
    $defs: { T: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' }, c: { type: 'string' }, d: { type: 'string' }, e: { type: 'string' } } } },
    $ref: '#/$defs/T',
  };
  const guide: Guide = {
    groups: [],
    kinds: {},
    fields: {
      'T#a': { tier: 'recommended' },
      'T#b': {},
      'T#c': { tier: 'advanced' },
      'T#d': { hidden: true },
    },
  };
  it('tier / no tier / no entry / hidden', () => {
    const items = addableAt(bundleOf(schema), guide, [], {});
    expect(items.map((i) => [i.key, i.tier])).toEqual([
      ['a', 'recommended'],
      ['b', 'common'],
      ['c', 'advanced'],
      ['e', 'advanced'],
    ]);
  });
});

describe('valueTemplateAt', () => {
  it('gives {} for Container#resources and the guide example for image', async () => {
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const data = { spec: { template: { spec: { containers: [{ name: 'a' }] } } } };
    expect(valueTemplateAt(bundle, kubernetesGuide, [...CONTAINER_PATH, 'resources'], data)).toEqual({});
    expect(valueTemplateAt(bundle, kubernetesGuide, [...CONTAINER_PATH, 'image'], data)).toBe('nginx:1.27');
    expect(valueTemplateAt(bundle, kubernetesGuide, [...CONTAINER_PATH, 'name'], data)).toBe('');
  });
});
