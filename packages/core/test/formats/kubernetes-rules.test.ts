import { describe, expect, it } from 'vitest';
import { applyEdit } from '../../src/document/edit.js';
import { parseText } from '../../src/document/parse.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { Problem } from '../../src/validation/problems.js';
import { validateText } from '../../src/validation/validate.js';

const rules = async (text: string, id?: string): Promise<Problem[]> =>
  (await validateText(parseText(text), kubernetesFormat)).filter(
    (p) => p.source === 'rule' && (id === undefined || p.code === `rule.${id}`),
  );
const slice = (text: string, p: Problem): string => text.slice(p.from, p.to);
const join = (...docs: string[]): string => docs.join('---\n');
const indent = (n: number, lines: readonly string[]): string => lines.map((l) => `${' '.repeat(n)}${l}\n`).join('');

interface DeploymentOpts {
  readonly ns?: string;
  readonly ports?: string;
  readonly selector?: readonly string[];
}
/** A Deployment whose container has limits; `labels` are `k: v` lines for the template (and the selector, unless given). */
const deployment = (name: string, labels: readonly string[], o: DeploymentOpts = {}): string =>
  `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\n${o.ns ? `  namespace: ${o.ns}\n` : ''}` +
  `spec:\n  selector:\n    matchLabels:\n${indent(6, o.selector ?? labels)}` +
  `  template:\n    metadata:\n      labels:\n${indent(8, labels)}` +
  `    spec:\n      containers:\n        - name: app\n          image: nginx\n${o.ports ?? ''}` +
  `          resources:\n            limits:\n              memory: 64Mi\n`;

const service = (selector: readonly string[], extra = '', ns?: string): string =>
  `apiVersion: v1\nkind: Service\nmetadata:\n  name: svc\n${ns ? `  namespace: ${ns}\n` : ''}` +
  `spec:\n  selector:\n${indent(4, selector)}  ports:\n    - port: 80\n${extra}`;

describe('service-selector', () => {
  const dep = (n: string, v: string) => deployment(n, [`app: ${v}`]);

  it('warns when nothing matches; silent when one of two workloads matches', async () => {
    const none = join(dep('a', 'a'), dep('b', 'b'), service(['app: c', 'tier: x']));
    const ps = await rules(none, 'service-selector');
    expect(ps.map((p) => [p.severity, p.message, slice(none, p)])).toEqual([
      ['warning', 'No workload in this file has the labels app=c, tier=x.', 'selector'],
    ]);
    expect(await rules(join(dep('a', 'a'), dep('b', 'b'), service(['app: b'])), 'service-selector')).toEqual([]);
  });

  it('a workload in another namespace does not count', async () => {
    const other = deployment('a', ['app: a'], { ns: 'other' });
    expect(await rules(join(other, dep('b', 'b'), service(['app: a'])), 'service-selector')).toHaveLength(1);
    expect(await rules(join(other, service(['app: a'], '', 'other')), 'service-selector')).toEqual([]);
    // the only workload lives elsewhere, so the Service's namespace has none: silent
    expect(await rules(join(other, service(['app: zzz'])), 'service-selector')).toEqual([]);
  });

  it('silent when the file has no workloads, or the Service has no selector', async () => {
    expect(await rules(service(['app: a']), 'service-selector')).toEqual([]);
    const noSelector = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  type: ClusterIP\n';
    expect(await rules(join(dep('a', 'a'), noSelector), 'service-selector')).toEqual([]);
  });
});

describe('selector-mismatch', () => {
  it('error naming the mismatched pairs; silent when matchLabels is a subset of the template labels', async () => {
    const text = deployment('a', ['app: a', 'tier: web'], { selector: ['app: b', 'tier: web', 'extra: x'] });
    const ps = await rules(text, 'selector-mismatch');
    expect(ps.map((p) => [p.severity, p.message, slice(text, p)])).toEqual([
      ['error', 'The selector does not match the pod template labels: app=b, extra=x.', 'matchLabels'],
    ]);
    const subset = deployment('a', ['app: a', 'tier: web'], { selector: ['app: a'] });
    expect(await rules(subset, 'selector-mismatch')).toEqual([]);
  });

  it('CronJob and Job are not checked; matchExpressions alone is silent', async () => {
    const job =
      'apiVersion: batch/v1\nkind: Job\nmetadata:\n  name: j\nspec:\n  selector:\n    matchLabels:\n      a: b\n  template:\n    spec:\n      containers:\n        - name: c\n          image: x\n          resources:\n            limits:\n              memory: 1Mi\n      restartPolicy: Never\n';
    expect(await rules(job, 'selector-mismatch')).toEqual([]);
    const exprs = deployment('a', ['app: a']).replace(
      '    matchLabels:\n      app: a\n',
      '    matchExpressions:\n      - key: app\n        operator: Exists\n',
    );
    expect(exprs).toContain('matchExpressions');
    expect(await rules(exprs, 'selector-mismatch')).toEqual([]);
  });
});

describe('missing-resources', () => {
  const bare = (extra = '') =>
    `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: d\nspec:\n  selector:\n    matchLabels:\n      a: b\n  template:\n    metadata:\n      labels:\n        a: b\n    spec:\n      initContainers:\n        - name: init\n          image: x\n      containers:\n        - name: app\n          image: nginx\n${extra}`;

  it('Deployment, CronJob and Pod containers; initContainers are not checked', async () => {
    const text = join(
      bare(),
      'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: c\nspec:\n  schedule: "* * * * *"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          containers:\n            - image: x\n              name: job\n          restartPolicy: Never\n',
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: pod\n      image: x\n    - name: ok\n      image: y\n      resources:\n        requests:\n          cpu: 1m\n',
    );
    const ps = await rules(text, 'missing-resources');
    expect(ps.map((p) => [p.severity, p.message, slice(text, p)])).toEqual([
      ['warning', 'Container "app" has no resource requests or limits.', 'app'],
      ['warning', 'Container "job" has no resource requests or limits.', 'job'],
      ['warning', 'Container "pod" has no resource requests or limits.', 'pod'],
    ]);
    expect(ps[0]?.fix?.label).toBe('Add resource requests and limits');
  });

  it('a container without a name is reported at the container item', async () => {
    const text = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - image: x\n';
    const [p] = await rules(text, 'missing-resources');
    expect(p?.message).toBe('Container "0" has no resource requests or limits.');
    expect(slice(text, p!)).toContain('image: x');
  });

  it.each([
    ['absent', ''],
    ['empty', '          resources: {}\n'],
    ['claims only', '          resources:\n            claims: []\n'],
  ])('fix (%s resources): applying its ops yields a document where the rule is silent', async (_k, extra) => {
    let text = bare(extra);
    const [p] = await rules(text, 'missing-resources');
    const action = p?.fix?.action;
    expect(action?.kind).toBe('edit');
    if (action?.kind !== 'edit') return;
    for (const op of action.ops) {
      const r = applyEdit(parseText(text), op);
      expect(r.ok).toBe(true);
      if (r.ok) text = r.text;
    }
    expect(text).toContain('memory: 256Mi');
    expect(await rules(text, 'missing-resources')).toEqual([]);
  });
});

describe('missing-resources fix safety', () => {
  const pod = (res: string) =>
    `apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: app\n      image: x\n${res}`;

  it('a non-empty resources keeps its other keys: claims survive and the rule is silent', async () => {
    let text = pod('      resources:\n        claims:\n          - name: gpu\n');
    const [p] = await rules(text, 'missing-resources');
    const action = p?.fix?.action;
    expect(action?.kind).toBe('edit');
    if (action?.kind !== 'edit') return;
    expect(action.ops.map((o) => o.op)).toEqual(['add', 'add']);
    for (const op of action.ops) {
      const r = applyEdit(parseText(text), op);
      expect(r.ok).toBe(true);
      if (r.ok) text = r.text;
    }
    expect(text).toContain('- name: gpu');
    expect(text).toContain('memory: 256Mi');
    expect(await rules(text, 'missing-resources')).toEqual([]);
  });

  it('resources: null is replaced (delete then add)', async () => {
    const [p] = await rules(pod('      resources:\n'), 'missing-resources');
    expect(p?.fix?.action.kind === 'edit' && p.fix.action.ops.map((o) => o.op)).toEqual(['delete', 'add']);
  });

  it('resources inherited through a merge key: warning without a fix', async () => {
    const text =
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: app\n      image: x\n      <<:\n        resources: {}\n';
    const ps = await rules(text, 'missing-resources');
    expect(ps).toHaveLength(1);
    expect(ps[0]?.fix).toBeUndefined();
  });
});

describe('target-port', () => {
  const dep = (n: string, port: string) =>
    deployment(n, ['app: a'], { ports: `          ports:\n            - name: ${port}\n              containerPort: 80\n` });
  const svc = (tp: string) => service(['app: a'], `      targetPort: ${tp}\n`);

  it('a name found in any matched workload is fine; an unknown name warns', async () => {
    expect(await rules(join(dep('a', 'http'), dep('b', 'metrics'), svc('metrics')), 'target-port')).toEqual([]);
    const text = join(dep('a', 'http'), svc('nope'));
    const ps = await rules(text, 'target-port');
    expect(ps.map((p) => [p.severity, p.message, slice(text, p)])).toEqual([
      ['warning', 'No container port is named "nope" in the selected workloads.', 'nope'],
    ]);
  });

  it('numeric targetPort is never checked', async () => {
    expect(await rules(join(dep('a', 'http'), svc('8080')), 'target-port')).toEqual([]);
  });
});

it('rules see merged data: labels from a merge key count', async () => {
  const text = join(
    'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: d\nspec:\n  selector:\n    matchLabels:\n      app: a\n  template:\n    metadata:\n      labels:\n        <<:\n          app: a\n    spec:\n      containers:\n        - name: c\n          image: x\n          resources:\n            limits:\n              memory: 1Mi\n',
    service(['app: a']),
  );
  expect(await rules(text)).toEqual([]);
});
