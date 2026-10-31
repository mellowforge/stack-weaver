import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { yamlDocs } from '../../src/document/internal.js';
import { loadComposeSchema } from '../../src/formats/compose/loader.js';

// Compose files use YAML 1.1 `<<` merge keys; parseText keeps the 1.2 core schema (editing paths
// must not see through merges), so merge resolution is enabled on the document just for toJS().
const fixture = (name: string) => {
  const d = yamlDocs(parseText(readFileSync(new URL(`../fixtures/corpus/${name}`, import.meta.url), 'utf8')))[0]!;
  d.setSchema('1.1', { merge: true });
  return d.toJS() as Record<string, unknown>;
};

describe('loadComposeSchema', () => {
  it('compose fixture with anchors validates []', async () => {
    const bundle = await loadComposeSchema();
    expect(bundle.id).toBe('compose');
    expect(bundle.validate(fixture('compose-anchors.yaml'))).toEqual([]);
  });

  it('all compose corpus fixtures validate []', async () => {
    const bundle = await loadComposeSchema();
    for (const f of ['compose-basic', 'compose-env-placeholders', 'compose-long-form-ports', 'compose-networks-healthcheck']) {
      expect(bundle.validate(fixture(`${f}.yaml`)), f).toEqual([]);
    }
  });

  it('services.web.ports: "abc" (invalid) yields an error', async () => {
    const bundle = await loadComposeSchema();
    const errors = bundle.validate({ services: { web: { image: 'nginx', ports: 'abc' } } });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.instancePath === '/services/web/ports')).toBe(true);
  });

  it('unknown top-level key "foo" yields additionalProperties error', async () => {
    const bundle = await loadComposeSchema();
    const errors = bundle.validate({ services: {}, foo: 1 });
    expect(errors.some((e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'foo')).toBe(true);
  });

  it('x-variables top-level key is allowed', async () => {
    const bundle = await loadComposeSchema();
    expect(bundle.validate({ services: {}, 'x-variables': { a: 1 } })).toEqual([]);
  });

  it('caches the bundle and exposes a schema with $defs', async () => {
    const a = await loadComposeSchema();
    expect(await loadComposeSchema()).toBe(a);
    expect(a.schema.$defs).toBeTypeOf('object');
  });
});
