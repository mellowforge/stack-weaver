import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';

const fx = (n: string) => parseText(readFileSync(new URL(`../fixtures/corpus/${n}`, import.meta.url), 'utf8'));
const both = (t: string) => [kubernetesFormat.detect(parseText(t)), composeFormat.detect(parseText(t))];

describe('detect', () => {
  it('web-app fixture is kubernetes only', () => {
    const p = fx('k8s-web-app.yaml');
    expect([kubernetesFormat.detect(p), composeFormat.detect(p)]).toEqual([true, false]);
  });
  it('compose fixtures are compose only', () => {
    for (const n of ['compose-basic.yaml', 'compose-anchors.yaml', 'compose-networks-healthcheck.yaml']) {
      const p = fx(n);
      expect([kubernetesFormat.detect(p), composeFormat.detect(p)], n).toEqual([false, true]);
    }
  });
  it('empty, comment-only and broken text are neither', () => {
    expect(both('')).toEqual([false, false]);
    expect(both('# hi\n')).toEqual([false, false]);
    expect(both('a: [\n')).toEqual([false, false]);
  });
  it('kubernetes requires every document to have apiVersion and kind', () => {
    expect(both('apiVersion: v1\nkind: Pod\n---\nfoo: 1\n')[0]).toBe(false);
    expect(both('apiVersion: v1\nkind: Pod\n---\napiVersion: v1\nkind: Service\n')[0]).toBe(true);
    expect(both('apiVersion: 1\nkind: Pod\n')[0]).toBe(false);
  });
  it('compose requires a single doc without apiVersion', () => {
    expect(both('services: {}\n---\nservices: {}\n')[1]).toBe(false);
    expect(both('apiVersion: v1\nservices: {}\n')[1]).toBe(false);
    expect(both('name: x\n')[1]).toBe(false);
    expect(both('include: [a.yaml]\n')[1]).toBe(true);
  });
  it('loadSchema', async () => {
    const k = await kubernetesFormat.loadSchema(fx('k8s-web-app.yaml'), 0);
    expect(k?.id).toBe('apps_v1_Deployment');
    expect(await kubernetesFormat.loadSchema(fx('k8s-crd-unknown-kind.yaml'), 0)).toBeUndefined();
    expect(await kubernetesFormat.loadSchema(parseText('foo: 1\n'), 0)).toBeUndefined();
    expect((await composeFormat.loadSchema(fx('compose-basic.yaml'), 0)).id).toBe('compose');
  });
});
