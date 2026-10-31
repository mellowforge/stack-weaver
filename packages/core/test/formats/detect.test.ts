import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toData } from '../../src/document/data.js';
import { detectInputOf } from '../../src/formats/registry.js';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';

const fx = (n: string) => parseText(readFileSync(new URL(`../fixtures/corpus/${n}`, import.meta.url), 'utf8'));
const both = (t: string) => [kubernetesFormat.detect(detectInputOf(parseText(t))), composeFormat.detect(detectInputOf(parseText(t)))];

describe('detect', () => {
  it('web-app fixture is kubernetes only', () => {
    const p = fx('k8s-web-app.yaml');
    expect([kubernetesFormat.detect(detectInputOf(p)), composeFormat.detect(detectInputOf(p))]).toEqual([true, false]);
  });
  it('compose fixtures are compose only', () => {
    for (const n of ['compose-basic.yaml', 'compose-anchors.yaml', 'compose-networks-healthcheck.yaml']) {
      const p = fx(n);
      expect([kubernetesFormat.detect(detectInputOf(p)), composeFormat.detect(detectInputOf(p))], n).toEqual([false, true]);
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
  describe('empty and comment-only documents are ignored', () => {
    const pod = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\n';
    const compose = 'services:\n  web:\n    image: nginx\n';

    it('a trailing ---', () => {
      expect(both(`${pod}---\n`)).toEqual([true, false]);
      expect(both(`${compose}---\n`)).toEqual([false, true]);
    });

    it('the Helm form ---, # Source comment, ---, manifest', () => {
      expect(both(`---\n# Source: x.yaml\n---\n${pod}`)).toEqual([true, false]);
      expect(both(`---\n# Source: x.yaml\n---\n${compose}`)).toEqual([false, true]);
    });

    it('---\\n--- alone is neither', () => {
      expect(both('---\n---\n')).toEqual([false, false]);
    });

    it('the Helm fixture is kubernetes only', () => {
      const p = fx('k8s-helm-empty-docs.yaml');
      expect([kubernetesFormat.detect(detectInputOf(p)), composeFormat.detect(detectInputOf(p))]).toEqual([true, false]);
    });

    it('compose still needs exactly one non-empty document', () => {
      expect(both(`${compose}---\n${compose}`)[1]).toBe(false);
    });
  });

  it('loadSchema', async () => {
    const k = await kubernetesFormat.loadSchema(toData(fx('k8s-web-app.yaml'), 0));
    expect(k?.id).toBe('apps_v1_Deployment');
    expect(await kubernetesFormat.loadSchema(toData(fx('k8s-crd-unknown-kind.yaml'), 0))).toBeUndefined();
    expect(await kubernetesFormat.loadSchema({ foo: 1 })).toBeUndefined();
    expect(await kubernetesFormat.loadSchema('Deployment')).toBeUndefined();
    expect(await kubernetesFormat.loadSchema(undefined)).toBeUndefined();
    expect((await composeFormat.loadSchema(toData(fx('compose-basic.yaml'), 0)))?.id).toBe('compose');
  });
});
