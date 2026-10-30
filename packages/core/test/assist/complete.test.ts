import { beforeAll, describe, expect, it } from 'vitest';
import { completionsFor, type CompletionInput } from '../../src/assist/complete.js';
import type { CursorContext } from '../../src/assist/context.js';
import { kubernetesGuide } from '../../src/formats/kubernetes/guide.js';
import { kubernetesKinds, loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { SchemaBundle, Tier } from '../../src/formats/types.js';

const tierLabels: Record<Tier, string> = { recommended: 'Recommended', common: 'Common', advanced: 'Advanced' };
const CONTAINER = ['spec', 'template', 'spec', 'containers', 0] as const;

let deployment: SchemaBundle;
beforeAll(async () => {
  deployment = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
});

function ctx(over: Partial<CursorContext>): CursorContext {
  return { doc: 0, path: [], position: 'key', prefix: '', from: 0, indent: 0, ...over };
}

function input(over: Partial<CompletionInput> & { ctx: CursorContext }): CompletionInput {
  return { eol: '\n', bundle: deployment, guide: kubernetesGuide, data: {}, kinds: kubernetesKinds(), tierLabels, ...over };
}

const containerData = { spec: { template: { spec: { containers: [{ name: 'a', image: 'b' }] } } } };

describe('completionsFor keys', () => {
  it('offers missing container fields with tiers', () => {
    const out = completionsFor(input({ ctx: ctx({ path: CONTAINER, indent: 10 }), data: containerData }));
    const labels = out.map((c) => c.label);
    expect(labels).not.toContain('name');
    expect(labels).not.toContain('image');
    const resources = out.find((c) => c.label === 'resources')!;
    expect(resources.section).toEqual({ name: 'Recommended', rank: 0 });
    expect(resources.info).toBeTruthy();
    expect(out.find((c) => c.label === 'ports')!.section).toEqual({ name: 'Common', rank: 1 });
    expect(out.find((c) => c.label === 'args')!.section).toEqual({ name: 'Advanced', rank: 2 });
  });

  it('apply inserts key and colon', () => {
    const out = completionsFor(input({ ctx: ctx({ path: CONTAINER, indent: 10 }), data: containerData }));
    const apply = (label: string) => out.find((c) => c.label === label)!.apply;
    expect(apply('workingDir')).toBe('workingDir: ');
    expect(apply('resources')).toBe('resources:\n' + ' '.repeat(12));
    expect(apply('ports')).toBe('ports:\n' + ' '.repeat(10) + '- ');
    const crlf = completionsFor(input({ ctx: ctx({ path: CONTAINER, indent: 10 }), data: containerData, eol: '\r\n' }));
    expect(crlf.find((c) => c.label === 'resources')!.apply).toBe('resources:\r\n' + ' '.repeat(12));
  });

  it('required fields get boost 10 and detail required', () => {
    const data = { spec: { template: { spec: { containers: [{ image: 'b' }] } } } };
    const out = completionsFor(input({ ctx: ctx({ path: CONTAINER, indent: 10 }), data }));
    const name = out.find((c) => c.label === 'name')!;
    expect(name.boost).toBe(10);
    expect(name.detail).toBe('required');
    expect(out.find((c) => c.label === 'resources')!.boost).toBeUndefined();
  });

  it('a new sequence item path completes the item fields', () => {
    const out = completionsFor(input({ ctx: ctx({ path: [...CONTAINER.slice(0, 4), 1], indent: 10 }), data: containerData }));
    expect(out.map((c) => c.label)).toContain('name');
  });

  it('no bundle gives only kind/apiVersion at root, else []', () => {
    const root = completionsFor(input({ ctx: ctx({}), bundle: undefined, data: {} }));
    expect(root.map((c) => c.label)).toEqual(['apiVersion', 'kind']);
    expect(root.find((c) => c.label === 'kind')!.apply).toBe('kind: ');
    const partial = completionsFor(input({ ctx: ctx({}), bundle: undefined, data: { kind: 'Pod' } }));
    expect(partial.map((c) => c.label)).toEqual(['apiVersion']);
    expect(completionsFor(input({ ctx: ctx({ path: ['spec'], indent: 2 }), bundle: undefined }))).toEqual([]);
    expect(completionsFor(input({ ctx: ctx({}), bundle: undefined, kinds: [] }))).toEqual([]);
  });
});

describe('completionsFor values', () => {
  it('enum value completion', () => {
    // The Kubernetes schemas carry no `enum` keywords (they list options in prose), so use an inline schema.
    const bundle: SchemaBundle = {
      id: 't',
      validate: () => [],
      schema: {
        type: 'object',
        properties: { imagePullPolicy: { type: 'string', enum: ['Always', 'IfNotPresent', 'Never'] }, port: { anyOf: [{ type: 'integer' }, { type: 'string' }] } },
      },
    };
    const out = completionsFor(
      input({ bundle, ctx: ctx({ position: 'value', key: 'imagePullPolicy', prefix: 'If', from: 40, indent: 2 }), data: {} }),
    );
    expect(out.map((c) => c.label)).toEqual(['Always', 'IfNotPresent', 'Never']);
    expect(out.map((c) => c.apply)).toEqual(['Always', 'IfNotPresent', 'Never']);
    expect(completionsFor(input({ bundle, ctx: ctx({ position: 'value', key: 'port' }), data: {} }))).toEqual([]);
  });

  it('boolean value completion', () => {
    const out = completionsFor(input({ ctx: ctx({ path: CONTAINER, position: 'value', key: 'stdin' }), data: containerData }));
    expect(out.map((c) => c.label)).toEqual(['true', 'false']);
  });

  it('gives nothing for free-form or union values', () => {
    expect(completionsFor(input({ ctx: ctx({ path: CONTAINER, position: 'value', key: 'image' }), data: containerData }))).toEqual([]);
    expect(completionsFor(input({ ctx: ctx({ path: ['zzz'], position: 'value', key: 'x' }) }))).toEqual([]);
  });

  it('kind value at a document root lists kinds', () => {
    const out = completionsFor(input({ ctx: ctx({ position: 'value', key: 'kind' }), bundle: undefined }));
    const labels = out.map((c) => c.label);
    expect(labels).toContain('Deployment');
    expect(labels).toContain('Service');
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('apiVersion value narrows to the kind already typed', () => {
    const narrowed = completionsFor(input({ ctx: ctx({ position: 'value', key: 'apiVersion' }), data: { kind: 'Deployment' } }));
    expect(narrowed.map((c) => c.label)).toEqual(['apps/v1']);
    const all = completionsFor(input({ ctx: ctx({ position: 'value', key: 'apiVersion' }), data: {} }));
    expect(all.map((c) => c.label)).toContain('apps/v1');
    expect(all.map((c) => c.label)).toContain('v1');
    const unknown = completionsFor(input({ ctx: ctx({ position: 'value', key: 'apiVersion' }), data: { kind: 'Nope' } }));
    expect(unknown.map((c) => c.label)).toContain('v1');
  });
});
