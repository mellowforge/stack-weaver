import { beforeAll, describe, expect, it } from 'vitest';
import { breadcrumbAt, hoverAt } from '../../src/assist/hover.js';
import { parseText } from '../../src/document/parse.js';
import { kubernetesGuide } from '../../src/formats/kubernetes/guide.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import type { SchemaBundle } from '../../src/formats/types.js';

const TEXT = [
  'apiVersion: apps/v1',
  'kind: Deployment',
  'metadata:',
  '  name: web',
  'spec:',
  '  template:',
  '    spec:',
  '      containers:',
  '        - image: nginx',
  '          resources: {}',
  '',
].join('\n');

let bundle: SchemaBundle;
beforeAll(async () => {
  bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
});

const inside = (needle: string, delta = 1) => TEXT.indexOf(needle) + delta;

describe('hoverAt', () => {
  it('hover over a key gives the guide label and first-sentence description', () => {
    const p = parseText(TEXT);
    const h = hoverAt(p, inside('resources'), bundle, kubernetesGuide)!;
    const from = TEXT.indexOf('resources');
    expect(h).toMatchObject({ from, to: from + 'resources'.length, title: 'CPU & memory', required: false });
    expect(h.description).toBeTruthy();
    expect(h.description).not.toMatch(/\n/);
  });

  it('hover over the required key marks required', () => {
    const p = parseText(TEXT.replace('- image: nginx', '- name: a'));
    const t = p.text;
    const h = hoverAt(p, t.indexOf('name: a') + 1, bundle, kubernetesGuide)!;
    expect(h).toMatchObject({ title: 'Name', required: true });
  });

  it('falls back to the key name for keys without a guide label', () => {
    const p = parseText(TEXT);
    const h = hoverAt(p, inside('template'), bundle, kubernetesGuide)!;
    expect(h.title).toBe('template');
    expect(h.description).toBeTruthy();
  });

  it('is undefined over values, unknown keys, without a bundle, and outside content', () => {
    const p = parseText(TEXT);
    expect(hoverAt(p, inside('nginx'), bundle, kubernetesGuide)).toBeUndefined();
    expect(hoverAt(p, inside('resources'), undefined, kubernetesGuide)).toBeUndefined();
    const q = parseText(TEXT.replace('resources: {}', 'bogus: {}'));
    expect(hoverAt(q, q.text.indexOf('bogus') + 1, bundle, kubernetesGuide)).toBeUndefined();
    expect(hoverAt(parseText(''), 0, bundle, kubernetesGuide)).toBeUndefined();
  });
});

describe('breadcrumbAt', () => {
  it('breadcrumb for a container image', () => {
    const p = parseText(TEXT);
    expect(breadcrumbAt(p, inside('image: nginx'))).toEqual(['Deployment web', 'spec', 'template', 'spec', 'containers', '0', 'image']);
  });

  it('starts with the kind alone when there is no metadata.name', () => {
    const p = parseText('kind: Service\nspec:\n  type: x\n');
    expect(breadcrumbAt(p, p.text.indexOf('type') + 1)).toEqual(['Service', 'spec', 'type']);
  });

  it('starts with Document n when there is no kind', () => {
    const p = parseText('a: 1\n---\nb:\n  c: 2\n');
    expect(breadcrumbAt(p, p.text.indexOf('c:') + 1)).toEqual(['Document 2', 'b', 'c']);
  });

  it('is empty outside any document', () => {
    expect(breadcrumbAt(parseText(''), 0)).toEqual([]);
  });
});
