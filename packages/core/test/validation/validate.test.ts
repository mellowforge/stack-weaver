import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toData } from '../../src/document/data.js';
import { parseText } from '../../src/document/parse.js';
import { getNode, refAtOffset } from '../../src/document/paths.js';
import { resolveAt } from '../../src/engine/resolve.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { defaultMessages } from '../../src/validation/messages.js';
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
          resources:
            limits: { memory: 64Mi }
`;

describe('validateText', () => {
  it('replicas: "three" gives an error at the scalar\'s exact from/to/line/col', async () => {
    const text = deployment('', '"three"');
    const probs = await validateText(parseText(text), kubernetesFormat);
    const from = text.indexOf('"three"');
    const hit = probs.find((x) => x.path.join('.') === 'spec.replicas');
    expect(hit).toMatchObject({ severity: 'error', source: 'schema', from, to: from + 7, line: 6, col: 13, doc: 0 });
    expect(hit!.message).toBe('Must be an integer');
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

  it('a dangling alias is a yaml.syntax error, and validateText resolves', async () => {
    const text = 'services:\n  web:\n    image: *nope\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.map((x) => [x.code, x.severity, x.from, x.to, x.doc])).toEqual([
      ['yaml.syntax', 'error', text.indexOf('*nope'), text.indexOf('*nope') + 5, 0],
    ]);
  });

  it('YAML warnings are reported as yaml.warning when the text parses', async () => {
    const text = 'services:\n  web:\n    image: !foo nginx\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.map((x) => [x.severity, x.source, x.code, x.from])).toEqual([
      ['warning', 'yaml', 'yaml.warning', text.indexOf('!foo')],
    ]);
    expect(probs[0]!.message).toMatch(/Unresolved tag/);
  });

  it('YAML warnings are reported as yaml.warning when the text does not parse', async () => {
    const text = 'a: !foo x\n---\nb: [\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.find((x) => x.code === 'yaml.warning')).toMatchObject({ severity: 'warning', source: 'yaml', doc: 0, from: 3 });
    expect(probs.find((x) => x.code === 'yaml.syntax')).toMatchObject({ severity: 'error', doc: 1 });
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
    expect(probs.every((x) => x.from > text.indexOf('---'))).toBe(true);
  });

  it('JSON-pointer segments are unescaped (~1 is /, ~0 is ~) to find the scalar', async () => {
    const text = deployment('  labels:\n    app.kubernetes.io/version: 1.0\n    a~b: 2\n');
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.path, x.from, x.to])).toEqual([
      ['schema.type', ['metadata', 'labels', 'app.kubernetes.io/version'], text.indexOf('1.0'), text.indexOf('1.0') + 3],
      ['schema.type', ['metadata', 'labels', 'a~b'], text.indexOf('a~b: 2') + 5, text.indexOf('a~b: 2') + 6],
    ]);
  });

  it('int-or-string collapses to one “Must be an integer or string”', async () => {
    const text = deployment('', '3', '  strategy:\n    rollingUpdate:\n      maxSurge: [1]\n');
    const probs = await validateText(parseText(text), kubernetesFormat);
    const hit = probs.filter((x) => x.path.join('.') === 'spec.strategy.rollingUpdate.maxSurge');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.message).toBe('Must be an integer or string');
  });

  it('compose-anchors.yaml validates with zero schema problems (merge keys)', async () => {
    const probs = await validateText(parseText(fixture('compose-anchors.yaml')), composeFormat);
    expect(probs.filter((x) => x.source === 'schema')).toEqual([]);
  });

  it('errors under a merged value map to the nearest existing ancestor and never throw', async () => {
    const text = 'x-c: &c\n  restart: [1]\nservices:\n  api:\n    <<: *c\n    image: a\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.map((x) => [x.code, x.path.join('.')])).toEqual([['schema.type', 'services.api.restart']]);
    expect(probs[0]!.from).toBe(text.indexOf('<<')); // the `api` map, which starts at `<<`
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

const brief = (probs: { code: string; path: readonly (string | number)[] }[]) => probs.map((x) => [x.code, x.path]);

describe('validateText never rejects (A4)', () => {
  it('a merge source that is not a map gives yaml.data at the << key and continues', async () => {
    const bad = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  <<: 5\n  name: x\n';
    const text = `${bad}---\n${deployment('', '"x"')}`;
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.severity, x.source, x.doc, x.path])).toEqual([
      ['yaml.data', 'error', 'yaml', 0, ['metadata', '<<']],
      ['schema.type', 'error', 'schema', 1, ['spec', 'replicas']],
    ]);
    expect(probs[0]!.from).toBe(text.indexOf('<<'));
    expect(probs[0]!.to).toBe(text.indexOf('<<') + 2);
  });

  it('a merge from a scalar alias gives yaml.data', async () => {
    const text = 'x-a: &a 1\nservices:\n  web:\n    <<: *a\n    image: x\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(brief(probs)).toEqual([['yaml.data', ['services', 'web', '<<']]]);
  });

  it('an excessive alias count gives yaml.data at the document root', async () => {
    const aliases = Array.from({ length: 101 }, () => '*a').join(', ');
    const text = `x-a: &a 1\nservices:\n  web:\n    image: x\n    command: [${aliases}]\n`;
    const probs = await validateText(parseText(text), composeFormat);
    expect(brief(probs)).toEqual([['yaml.data', []]]);
    expect(probs[0]!.from).toBe(0);
  });

  it('a loadSchema failure gives schema.unavailable naming the kind and the cause', async () => {
    const failing = { ...kubernetesFormat, loadSchema: () => Promise.reject(new Error('offline')) };
    const probs = await validateText(parseText(deployment()), failing);
    expect(probs.map((x) => [x.code, x.severity, x.message])).toEqual([
      ['schema.unavailable', 'error', 'Could not load the schema for Deployment: offline'],
    ]);
    const compose = { ...composeFormat, loadSchema: () => Promise.reject(new Error('chunk failed')) };
    const c = await validateText(parseText('services:\n  web:\n    image: x\n'), compose);
    expect(c.map((x) => x.message)).toEqual(['Could not load the schema for Docker Compose: chunk failed']);
  });
});

describe('validateText never rejects: third-party code', () => {
  it('a throwing ValidateFn gives schema.unavailable', async () => {
    const format = {
      ...composeFormat,
      loadSchema: async () => ({ id: 'x', schema: {}, validate: () => { throw new Error('bad validator'); } }),
    };
    const probs = await validateText(parseText('services:\n  web:\n    image: x\n'), format);
    expect(probs.map((x) => [x.code, x.message])).toEqual([
      ['schema.unavailable', 'Could not load the schema for Docker Compose: bad validator'],
    ]);
  });

  it('a throwing message override falls back to the default text', async () => {
    const probs = await validateText(parseText(deployment('', '"x"')), kubernetesFormat, {
      messages: { type: () => { throw new Error('oops'); } },
    });
    expect(probs.map((x) => x.message)).toEqual(['Must be an integer']);
  });
});

describe('empty and comment-only documents (A5)', () => {
  const pod = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: x\nspec:\n  containers:\n    - name: a\n      image: nginx\n      resources:\n        limits:\n          memory: 64Mi\n';
  const compose = 'services:\n  web:\n    image: nginx\n';

  it.each([
    ['a trailing ---', `${pod}---\n`],
    ['the Helm form', `---\n# Source: x.yaml\n---\n${pod}`],
    ['---\\n--- alone', '---\n---\n'],
  ])('kubernetes: %s validates to []', async (_, text) => {
    expect(await validateText(parseText(text), kubernetesFormat)).toEqual([]);
  });

  it.each([
    ['a trailing ---', `${compose}---\n`],
    ['the Helm form', `---\n# Source: x.yaml\n---\n${compose}`],
  ])('compose: %s validates to []', async (_, text) => {
    expect(await validateText(parseText(text), composeFormat)).toEqual([]);
  });

  it('the Helm fixture validates to []', async () => {
    expect(await validateText(parseText(fixture('k8s-helm-empty-docs.yaml')), kubernetesFormat)).toEqual([]);
  });
});

describe('compose: one bad field gives one problem (A6)', () => {
  const svc = (body: string) => `services:\n  w:\n    image: nginx\n${body}`;

  it('ports: "abc" gives only the type error', async () => {
    const probs = await validateText(parseText(svc('    ports: "abc"\n')), composeFormat);
    expect(brief(probs)).toEqual([['schema.type', ['services', 'w', 'ports']]]);
    expect(probs[0]!.message).toBe('Must be an array');
  });

  it('environment: { TZ: [1] } gives only the error on TZ', async () => {
    const probs = await validateText(parseText(svc('    environment: { TZ: [1] }\n')), composeFormat);
    expect(brief(probs)).toEqual([['schema.type', ['services', 'w', 'environment', 'TZ']]]);
  });

  it('a truly unknown key still gives Unknown field', async () => {
    const probs = await validateText(parseText(svc('    bogus: 1\n')), composeFormat);
    expect(brief(probs)).toEqual([['schema.unevaluatedProperties', ['services', 'w', 'bogus']]]);
    expect(probs[0]!.message).toBe('Unknown field “bogus”');
  });

  it('a bad field next to an unknown key gives both', async () => {
    const probs = await validateText(parseText(svc('    ports: "abc"\n    bogus: 1\n')), composeFormat);
    expect(brief(probs)).toEqual([
      ['schema.type', ['services', 'w', 'ports']],
      ['schema.unevaluatedProperties', ['services', 'w', 'bogus']],
    ]);
  });
});

describe('kubernetes document shape and kinds (A7)', () => {
  it('a non-mapping root gives schema.type “A document must be a mapping”', async () => {
    const probs = await validateText(parseText('- a\n- b\n'), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.severity, x.path, x.message])).toEqual([
      ['schema.type', 'error', [], 'A document must be a mapping'],
    ]);
  });

  it('a missing kind gives schema.required at the root', async () => {
    const probs = await validateText(parseText('apiVersion: v1\nmetadata:\n  name: x\n'), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.path, x.message, x.from])).toEqual([
      ['schema.required', [], 'Missing required field “kind”', 0],
    ]);
  });

  it('a non-string apiVersion gives schema.required at that key', async () => {
    const text = 'apiVersion: 1\nkind: Pod\n';
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.path, x.from])).toEqual([['schema.required', ['apiVersion'], 12]]);
  });

  it('a known kind under a wrong apiVersion gives kind.apiVersion at the apiVersion value', async () => {
    const text = deployment().replace('apps/v1', 'apps/v');
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.map((x) => [x.code, x.severity, x.source, x.path, x.message, x.from, x.to])).toEqual([
      [
        'kind.apiVersion', 'error', 'schema', ['apiVersion'],
        '“apps/v” is not a valid apiVersion for Deployment; expected apps/v1', 12, 18,
      ],
    ]);
  });

  it('kind.apiVersion lists every valid apiVersion', async () => {
    const text = 'apiVersion: autoscaling/v9\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: x\n';
    const probs = await validateText(parseText(text), kubernetesFormat);
    expect(probs.map((x) => x.message)).toEqual([
      '“autoscaling/v9” is not a valid apiVersion for HorizontalPodAutoscaler; expected autoscaling/v1, autoscaling/v2',
    ]);
  });
});

describe('compose extra documents (A8)', () => {
  it('documents after the first non-empty one give format.extraDocument and are not validated', async () => {
    const text = '---\n---\nservices:\n  web:\n    image: x\n---\nfoo: 1\n';
    const probs = await validateText(parseText(text), composeFormat);
    expect(probs.map((x) => [x.code, x.severity, x.doc, x.path, x.message])).toEqual([
      ['format.extraDocument', 'error', 2, [], 'Compose files contain one document; this one is ignored'],
    ]);
    expect(probs[0]!.from).toBe(text.indexOf('foo'));
  });
});

describe('messages (B2)', () => {
  it('uses a/an correctly', () => {
    const type = (t: unknown) => defaultMessages['type']!({ instancePath: '', keyword: 'type', params: { type: t } });
    expect(type('integer')).toBe('Must be an integer');
    expect(type(['array', 'object'])).toBe('Must be an array or object');
    expect(type('string')).toBe('Must be a string');
  });

  it('validateText merges a partial message override', async () => {
    const text = deployment('', '"three"').replace('        - name: web\n          image: nginx', '        - image: nginx');
    const probs = await validateText(parseText(text), kubernetesFormat, {
      messages: { type: (e) => `Typ: ${String(e.params['type'])}` },
    });
    expect(probs.map((x) => x.message)).toEqual(['Typ: integer', 'Missing required field “name”']);
  });

  it('the core texts come from the table and can be overridden', async () => {
    const probs = await validateText(parseText(fixture('k8s-crd-unknown-kind.yaml')), kubernetesFormat, {
      messages: { 'kind.unknown': (e) => `Unbekannt: ${String(e.params['kind'])}` },
    });
    expect(probs[0]!.message).toBe('Unbekannt: Widget');
  });
});

describe('numeric map keys', () => {
  const text = `apiVersion: v1
kind: ConfigMap
metadata:
  name: tcp-services
data:
  8080: default/web:80
  9090: 80
`;

  it('refAtOffset, getNode, the problem path and resolveAt agree on a string segment', async () => {
    const p = parseText(text);
    const ref = refAtOffset(p, text.indexOf('default/web'));
    expect(ref).toEqual({ doc: 0, path: ['data', '8080'] });
    expect((getNode(p, ref!) as { value: unknown }).value).toBe('default/web:80');

    const probs = await validateText(p, kubernetesFormat);
    expect(probs.map((x) => [x.code, x.path])).toEqual([['schema.type', ['data', '9090']]]);
    const bad = probs[0]!;
    expect(bad.from).toBe(text.lastIndexOf('80'));
    expect(refAtOffset(p, bad.from)).toEqual({ doc: 0, path: bad.path });
    expect(getNode(p, { doc: 0, path: bad.path })).toBeDefined();

    const bundle = (await kubernetesFormat.loadSchema(p, 0))!;
    const data = toData(p, 0);
    expect(resolveAt(bundle, ref!.path, data)?.schema['type']).toBe('string');
    expect(resolveAt(bundle, bad.path, data)?.schema['type']).toBe('string');
  });
});

describe('toData', () => {
  it('leaves the original doc unchanged and resolves merges in the result', () => {
    const p = parseText(fixture('compose-anchors.yaml'));
    const doc = p.docs[0]!;
    const before = doc.toString();
    const rawBefore = JSON.stringify(doc.toJS());
    const data = toData(p, 0) as { services: { api: Record<string, unknown> } };
    expect(data.services.api.restart).toBe('unless-stopped');
    expect(doc.toString()).toBe(before);
    expect(JSON.stringify(doc.toJS())).toBe(rawBefore);
    expect(doc.schema.name).toBe('core');
  });
});
