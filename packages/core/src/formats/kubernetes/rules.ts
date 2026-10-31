import type { EditOp } from '../../document/edit.js';
import { ownMapValue } from '../../document/internal.js';
import type { NodeRef, YamlPath } from '../../document/types.js';
import type { Rule, RuleFinding, RuleInput } from '../types.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const rec = (v: unknown): Rec | undefined => (isRec(v) ? v : undefined);
const child = (v: unknown, ...keys: readonly (string | number)[]): unknown => keys.reduce<unknown>((at, k) => rec(at)?.[k], v);

/** A map of strings (label sets); non-record values give an empty one. */
function stringMap(v: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (isRec(v)) for (const [k, val] of Object.entries(v)) out.set(k, String(val));
  return out;
}

interface Workload {
  readonly doc: number;
  readonly namespace: string;
  /** Path of the pod template (or of the Pod itself). */
  readonly templatePath: YamlPath;
  readonly labels: Map<string, string>;
  readonly containers: readonly unknown[];
  /** `spec.selector.matchLabels`, for the kinds whose selector is checked. */
  readonly matchLabels?: Map<string, string>;
}

/** Where each kind keeps its pod template; `selector` marks the kinds whose `matchLabels` are checked. */
const TEMPLATES: Record<string, { readonly path: YamlPath; readonly selector: boolean }> = {
  Deployment: { path: ['spec', 'template'], selector: true },
  StatefulSet: { path: ['spec', 'template'], selector: true },
  DaemonSet: { path: ['spec', 'template'], selector: true },
  ReplicaSet: { path: ['spec', 'template'], selector: true },
  Job: { path: ['spec', 'template'], selector: false },
  CronJob: { path: ['spec', 'jobTemplate', 'spec', 'template'], selector: false },
  Pod: { path: [], selector: false },
};

const namespaceOf = (data: unknown): string => {
  const ns = child(data, 'metadata', 'namespace');
  return typeof ns === 'string' && ns !== '' ? ns : 'default';
};

/** The workloads of the file, by index over the (possibly sparse) documents. */
function collect(input: RuleInput): Workload[] {
  const out: Workload[] = [];
  for (let doc = 0; doc < input.parsed.docCount; doc++) {
    const data = input.data[doc];
    const kind = child(data, 'kind');
    if (typeof kind !== 'string' || !Object.hasOwn(TEMPLATES, kind)) continue;
    const t = TEMPLATES[kind]!;
    const template = child(data, ...t.path);
    if (!isRec(template)) continue;
    const containers = child(template, 'spec', 'containers');
    out.push({
      doc,
      namespace: namespaceOf(data),
      templatePath: t.path,
      labels: stringMap(child(template, 'metadata', 'labels')),
      containers: Array.isArray(containers) ? containers : [],
      ...(t.selector ? { matchLabels: stringMap(child(data, 'spec', 'selector', 'matchLabels')) } : {}),
    });
  }
  return out;
}

const pairs = (m: ReadonlyMap<string, string>): string => [...m].map(([k, v]) => `${k}=${v}`).join(', ');

interface ServiceInfo {
  readonly doc: number;
  readonly data: Rec;
  readonly selector: Map<string, string>;
  readonly inNamespace: Workload[];
  readonly matched: Workload[];
}

/** The Services with a selector, each with the workloads of its namespace and those its selector matches. */
function services(input: RuleInput, workloads: readonly Workload[]): ServiceInfo[] {
  const out: ServiceInfo[] = [];
  for (let doc = 0; doc < input.parsed.docCount; doc++) {
    const data = rec(input.data[doc]);
    if (!data || data['kind'] !== 'Service') continue;
    const selector = stringMap(child(data, 'spec', 'selector'));
    if (selector.size === 0) continue;
    const ns = namespaceOf(data);
    const inNamespace = workloads.filter((w) => w.namespace === ns);
    const matched = inNamespace.filter((w) => [...selector].every(([k, v]) => w.labels.get(k) === v));
    out.push({ doc, data, selector, inNamespace, matched });
  }
  return out;
}

const serviceSelector: Rule = {
  id: 'service-selector',
  messages: {
    'rule.service-selector': (e) => `No workload in this file has the labels ${String(e.params['selector'])}.`,
  },
  check(input) {
    const out: RuleFinding[] = [];
    for (const s of services(input, collect(input))) {
      if (s.inNamespace.length === 0 || s.matched.length > 0) continue;
      out.push({
        severity: 'warning',
        doc: s.doc,
        path: ['spec', 'selector'],
        at: 'key',
        params: { selector: pairs(s.selector) },
      });
    }
    return out;
  },
};

const selectorMismatch: Rule = {
  id: 'selector-mismatch',
  messages: {
    'rule.selector-mismatch': (e) => `The selector does not match the pod template labels: ${String(e.params['labels'])}.`,
  },
  check(input) {
    const out: RuleFinding[] = [];
    for (const w of collect(input)) {
      if (!w.matchLabels) continue;
      const bad = new Map([...w.matchLabels].filter(([k, v]) => w.labels.get(k) !== v));
      if (bad.size === 0) continue;
      out.push({
        severity: 'error',
        doc: w.doc,
        path: ['spec', 'selector', 'matchLabels'],
        at: 'key',
        params: { labels: pairs(bad) },
      });
    }
    return out;
  },
};

const DEFAULT_RESOURCES = { requests: { cpu: '100m', memory: '128Mi' }, limits: { memory: '256Mi' } };

/**
 * The ops that give a container default resources, or `undefined` when none is safe. An empty or null
 * `resources` is replaced; a mapping with other keys (for example `claims`) keeps them and gains
 * `requests` and `limits`. A `resources` that the container only inherits (a `<<` merge) gets no fix.
 */
function fixOps(input: RuleInput, at: NodeRef, container: Rec, res: unknown): readonly EditOp[] | undefined {
  if (!Object.hasOwn(container, 'resources')) return [{ op: 'add', at, key: 'resources', value: DEFAULT_RESOURCES }];
  const own = ownMapValue(input.parsed, at, 'resources');
  if (!own) return undefined;
  if (res === null || (isRec(res) && Object.keys(res).length === 0)) {
    return [
      { op: 'delete', at: { doc: at.doc, path: [...at.path, 'resources'] } },
      { op: 'add', at, key: 'resources', value: DEFAULT_RESOURCES },
    ];
  }
  if (!isRec(res) || !own.isMap) return undefined;
  const target = { doc: at.doc, path: [...at.path, 'resources'] };
  return [
    { op: 'add', at: target, key: 'requests', value: DEFAULT_RESOURCES.requests },
    { op: 'add', at: target, key: 'limits', value: DEFAULT_RESOURCES.limits },
  ];
}

const missingResources: Rule = {
  id: 'missing-resources',
  messages: {
    'rule.missing-resources': (e) => `Container "${String(e.params['name'])}" has no resource requests or limits.`,
    'fix.add-resources': () => 'Add resource requests and limits',
  },
  check(input) {
    const out: RuleFinding[] = [];
    for (const w of collect(input)) {
      const base: YamlPath = [...w.templatePath, 'spec', 'containers'];
      for (let j = 0; j < w.containers.length; j++) {
        const c = rec(w.containers[j]);
        if (!c) continue;
        const res = c['resources'];
        if (isRec(res) && (res['requests'] !== undefined || res['limits'] !== undefined)) continue;
        const at = { doc: w.doc, path: [...base, j] };
        const name = typeof c['name'] === 'string' ? c['name'] : undefined;
        const ops = fixOps(input, at, c, res);
        out.push({
          severity: 'warning',
          doc: w.doc,
          path: name !== undefined ? [...at.path, 'name'] : at.path,
          params: { name: name ?? String(j) },
          ...(ops ? { fix: { key: 'fix.add-resources', action: { kind: 'edit' as const, ops } } } : {}),
        });
      }
    }
    return out;
  },
};

const targetPort: Rule = {
  id: 'target-port',
  messages: {
    'rule.target-port': (e) => `No container port is named "${String(e.params['port'])}" in the selected workloads.`,
  },
  check(input) {
    const out: RuleFinding[] = [];
    for (const s of services(input, collect(input))) {
      if (s.matched.length === 0) continue;
      const ports = child(s.data, 'spec', 'ports');
      if (!Array.isArray(ports)) continue;
      const names = new Set<string>();
      for (const w of s.matched) {
        for (const c of w.containers) {
          const cports = rec(c)?.['ports'];
          if (!Array.isArray(cports)) continue;
          for (const p of cports) {
            const n = rec(p)?.['name'];
            if (typeof n === 'string') names.add(n);
          }
        }
      }
      for (let i = 0; i < ports.length; i++) {
        const tp = rec(ports[i])?.['targetPort'];
        if (typeof tp !== 'string' || names.has(tp)) continue;
        out.push({ severity: 'warning', doc: s.doc, path: ['spec', 'ports', i, 'targetPort'], params: { port: tp } });
      }
    }
    return out;
  },
};

/** The semantic rules of Kubernetes: Service selectors, workload selectors, resources and named target ports. */
export const kubernetesRules: readonly Rule[] = [serviceSelector, selectorMismatch, missingResources, targetPort];
