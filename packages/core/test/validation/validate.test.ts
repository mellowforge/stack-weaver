import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toData } from '../../src/document/data.js';
import { parseText } from '../../src/document/parse.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { validateText } from '../../src/validation/validate.js';

const fixture = (n: string) => readFileSync(new URL(`../fixtures/corpus/${n}`, import.meta.url), 'utf8');
const deployment = (meta = '', replicas = '3', spec = '') => `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
${meta}spec:
  replicas: ${replicas}
${spec}  selector:
    matchLabels: { app: web }
  template:
    metadata:
      labels: { app: web }
    spec:
      containers:
        - name: web
          image: nginx
`;

describe('validateText', () => {
  it('replicas: "three" gives an error at the scalar\'s exact from/to/line/col', async () => {
    const text = deployment('', '"three"');
    const probs = await validateText(parseText(text), kubernetesFormat);
    const from = text.indexOf('"three"');
    const hit = probs.find((x) => x.path.join('.') === 'spec.replicas');
    expect(hit).toMatchObject({ severity: 'error', source: 'schema', from, to: from + 7, line: 6, col: 13, doc: 0 });
    expect(hit!.message).toBe('Must be a integer');
  });

  it('container without name gives Missing required field “name” on the containers[0] item', async () => {
    const text = deployment().replace('        - name: web\n          image: nginx', '        - image: nginx');
    const probs = await validateText(parseText(text), kubernetesFormat);
    const hit = probs.find((x) => x.message === 'Missing required field “name”');
    expect(hit).toBeDefined();
    expect(hit!.path).toEqual(['spec', 'template', 'spec', 'containers', 0]);
    expect(hit!.code).toBe('schema.required');
    expect(hit!.from).toBe(text.indexOf('image: nginx'));
  });

  it('CRD doc gives a single info kind.unknown and no errors', async () => {
    const probs = await validateText(parseText(fixture('k8s-crd-unknown-kind.yaml')), kubernetesFormat);
    expect(probs.filter((x) => x.code === 'kind.unknown')).toHaveLength(1);
    expect(probs.filter((x) => x.severity === 'error')).toEqual([]);
    expect(probs[0]!.severity).toBe('info');
    expect(probs[0]!.message).toMatch(/^Unknown kind “.+” — edit in code$/);
  });

  it('broken YAML gives only yaml.syntax problems', async () => {
    const probs = await validateText(parseText('a: [1, 2\nb: : :\n'), kubernetesFormat);
    expect(probs.length).toBeGreaterThan(0);
    expect(probs.every((x) => x.code === 'yaml.syntax' && x.source === 'yaml' && x.severity === 'error')).toBe(true);
  });

  it('compose unknown top-level key gives Unknown field “foo”', async () => {
    const text = 'services:\n  web:\n    image: nginx\nfoo: 1\n';
    const probs = await validateText(parseText(text), composeFormat);
    const hit = probs.find((x) => x.message === 'Unknown field “foo”');
    expect(hit).toBeDefined();
    expect(hit!.from).toBe(text.indexOf('foo'));
    expect(hit!.to).toBe(text.indexOf('foo') + 3);
    expect(hit!.line).toBe(4);
  });

  it('multi-doc: problem.doc indexes the right document', async () => {
    const text = `${deployment()}---\n${deployment('', '"x"')}`;
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.length).toBeGreaterThan(0);
    expect(probs.every((x) => x.doc === 1)).toBe(true);
  });

  it('int-or-string collapses to one “Must be a integer or string”', async () => {
    const text = deployment('', '3', '  strategy:\n    rollingUpdate:\n      maxSurge: [1]\n');
    const probs = await validateText(parseText(text), kubernetesFormat);
    const hit = probs.filter((x) => x.path.join('.') === 'spec.strategy.rollingUpdate.maxSurge');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.message).toBe('Must be a integer or string');
  });

  it('compose-anchors.yaml validates with zero schema problems (merge keys)', async () => {
    const probs = await validateText(parseText(fixture('compose-anchors.yaml')), composeFormat);
    expect(probs.filter((x) => x.source === 'schema')).toEqual([]);
  });

  it('errors under a merged value map to the nearest existing ancestor and never throw', async () => {
    const text = 'x-c: &c\n  restart: [1]\nservices:\n  api:\n    <<: *c\n    image: a\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.length).toBeGreaterThan(0);
    for (const x of probs) {
      expect(x.from).toBeGreaterThanOrEqual(0);
      expect(x.to).toBeLessThanOrEqual(text.length);
    }
    const merged = probs.find((x) => x.path.join('.') === 'services.api.restart');
    expect(merged).toBeDefined();
    expect(merged!.from).toBe(text.indexOf('<<'));
  });

  it('Deployment with creationTimestamp: null produces zero schema problems', async () => {
    const probs = await validateText(parseText(deployment('  creationTimestamp: null\n')), kubernetesFormat);
    expect(probs).toEqual([]);
  });

  it('orders problems by from', async () => {
    const probs = await validateText(parseText(deployment('  labels: 5\n', '"x"')), kubernetesFormat);
    expect(probs.length).toBeGreaterThan(1);
    for (let i = 1; i < probs.length; i++) expect(probs[i]!.from).toBeGreaterThanOrEqual(probs[i - 1]!.from);
  });
});

describe('toData', () => {
  it('leaves the original doc unchanged and resolves merges in the result', () => {
    const p = parseText(fixture('compose-anchors.yaml'));
    const doc = p.docs[0]!;
    const before = doc.toString();
    const rawBefore = JSON.stringify(doc.toJS());
    const data = toData(doc) as { services: { api: Record<string, unknown> } };
    expect(data.services.api.restart).toBe('unless-stopped');
    expect(doc.toString()).toBe(before);
    expect(JSON.stringify(doc.toJS())).toBe(rawBefore);
    expect(doc.schema.name).toBe('core');
  });
});
