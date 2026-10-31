import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import { buildOutline } from '../../src/visual/outline-model.js';
import type { OutlineNode } from '../../src/visual/outline-model.js';

const guide = { groups: [], kinds: {}, fields: {} };
const fmt = (rootModel: 'documents' | 'mapping'): FormatDefinition => ({
  id: rootModel,
  label: rootModel,
  version: '1',
  rootModel,
  detect: () => true,
  kinds: () => [],
  loadSchema: async () => undefined,
  guide,
});
const labelFor = (_ref: unknown, key: string): string => (key === 'Deployment' ? 'Workload' : key);
const build = (text: string, f = fmt('documents'), unknown?: (doc: number, a: string, k: string) => boolean) =>
  buildOutline(parseText(text), f, labelFor, defaultUiMessages, unknown);
const walk = (nodes: readonly OutlineNode[]): OutlineNode[] => nodes.flatMap((n) => [n, ...walk(n.children)]);

describe('buildOutline', () => {
  it('a mapping format skips hiddenRootKey', () => {
    const text = 'x-variables:\n  A:\n    type: string\nservices:\n  web:\n    image: nginx\n';
    const f = fmt('mapping');
    const labels = (hidden?: string) =>
      buildOutline(parseText(text), f, labelFor, defaultUiMessages, undefined, undefined, hidden).map((n) => n.label);
    expect(labels()).toEqual(['x-variables', 'services']);
    expect(labels('x-variables')).toEqual(['services']);
  });

  it('documents become roots labelled by kind and name', () => {
    const roots = build('apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n---\napiVersion: v1\nkind: Service\n');
    expect(roots.map((r) => [r.id, r.label, r.type])).toEqual([
      ['0:', 'Workload web', 'document'],
      ['1:', 'Service', 'document'],
    ]);
  });

  it('empty documents are not roots', () => {
    expect(build('---\n# nothing\n---\napiVersion: v1\nkind: Service\n').map((r) => r.ref.doc)).toEqual([1]);
  });

  it('compose top-level keys become roots', () => {
    const roots = build('services:\n  web:\n    image: x\nvolumes:\n  data: {}\nname: demo\n', fmt('mapping'));
    expect(roots.map((r) => [r.id, r.label])).toEqual([
      ['0:services', 'services'],
      ['0:volumes', 'volumes'],
    ]);
    expect(roots[0]!.children.map((c) => c.id)).toEqual(['0:services/web']);
  });

  it('scalars are not outline nodes', () => {
    const [root] = build('apiVersion: v1\nkind: Service\nmetadata:\n  name: s\nspec:\n  type: ClusterIP\n');
    expect(root!.children.map((c) => c.label)).toEqual(['metadata', 'spec']);
    expect(walk([root!]).every((n) => n.type === 'document' || n.type === 'map' || n.type === 'seq')).toBe(true);
    expect(walk([root!]).map((n) => n.label)).not.toContain('type');
  });

  it('sequence items use name or "Item n"', () => {
    const [root] = build('kind: Pod\napiVersion: v1\nspec:\n  containers:\n    - name: app\n      image: x\n    - image: y\n    - 5\n');
    const containers = root!.children[0]!.children[0]!;
    expect(containers.type).toBe('seq');
    expect(containers.children.map((c) => [c.label, c.ref.path])).toEqual([
      ['app', ['spec', 'containers', 0]],
      ['Item 2', ['spec', 'containers', 1]],
    ]);
  });

  it('no ui message is concatenated: item and document labels come from templates', () => {
    const ui = { ...defaultUiMessages, itemLabel: 'Eintrag {n}.', documentLabel: '{n}. Dokument' };
    const labels = (text: string) => {
      const [root] = buildOutline(parseText(text), fmt('documents'), labelFor, ui);
      return root!;
    };
    const doc = labels('spec:\n  list:\n    - x: 1\n');
    expect(doc.label).toBe('1. Dokument');
    expect(doc.children[0]!.children[0]!.children[0]!.label).toBe('Eintrag 1.');
  });

  it('alias nodes are readOnly "alias"', () => {
    const [root] = build('kind: Pod\napiVersion: v1\nbase: &b\n  a: 1\ncopy: *b\n');
    const copy = root!.children.find((c) => c.label === 'copy');
    expect(copy?.readOnly).toBe('alias');
    expect(copy?.children).toEqual([]);
  });

  it('unknown kind is marked and has no children', () => {
    const roots = build(
      'apiVersion: x.io/v1\nkind: Widget\nspec:\n  a: {}\n---\napiVersion: v1\nkind: Service\nspec: {}\n',
      fmt('documents'),
      (_d, _a, kind) => kind === 'Widget',
    );
    expect(roots[0]).toMatchObject({ unknownKind: true, children: [], label: 'Widget' });
    expect(roots[1]!.unknownKind).toBeUndefined();
    expect(roots[1]!.children.length).toBe(1);
  });
});

describe('buildOutline with managed mappings', () => {
  it('leaves out a mapping that a widget edits itself, and keeps its siblings', () => {
    const text = 'apiVersion: v1\nkind: Secret\nmetadata:\n  name: s\ndata:\n  a: Yg==\n';
    const roots = buildOutline(parseText(text), fmt('documents'), labelFor, defaultUiMessages, undefined, (ref) => ref.path.join('/') === 'data');
    expect(roots[0]!.children.map((c) => c.label)).toEqual(['metadata']);
  });
});
