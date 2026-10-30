import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAlias, isScalar } from 'yaml';
import { parseText } from '../../src/document/parse.js';
import { getNode, getPairKey, refAtOffset, toLineCol } from '../../src/document/paths.js';

const corpus = (name: string): string =>
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'corpus', name), 'utf8');

const imagePath = ['spec', 'template', 'spec', 'containers', 0, 'image'] as const;

describe('paths', () => {
  const text = corpus('k8s-web-app.yaml');
  const p = parseText(text);

  it("getNode resolves ['spec','template','spec','containers',0,'image'] to the image scalar", () => {
    const n = getNode(p, { doc: 0, path: imagePath });
    expect(isScalar(n)).toBe(true);
    expect((n as { value: unknown }).value).toBe('nginx:1.27');
  });

  it('getNode returns undefined for missing paths and bad docs', () => {
    expect(getNode(p, { doc: 0, path: ['nope'] })).toBeUndefined();
    expect(getNode(p, { doc: 9, path: [] })).toBeUndefined();
  });

  it('getPairKey returns the key scalar of the pair holding ref', () => {
    expect(getPairKey(p, { doc: 0, path: imagePath })?.value).toBe('image');
    expect(
      getPairKey(p, { doc: 0, path: ['spec', 'template', 'spec', 'containers', 0] }),
    ).toBeUndefined();
  });

  it('refAtOffset on the image value returns that path', () => {
    const offset = text.indexOf('nginx:1.27') + 2;
    expect(refAtOffset(p, offset)).toEqual({ doc: 0, path: imagePath });
  });

  it('refAtOffset works in later documents', () => {
    const offset = text.indexOf('web.example.com') + 1;
    expect(refAtOffset(p, offset)).toEqual({ doc: 2, path: ['spec', 'rules', 0, 'host'] });
  });

  it('toLineCol is 1-based', () => {
    expect(toLineCol(p, 0)).toEqual({ line: 1, col: 1 });
    expect(toLineCol(p, text.indexOf('apiVersion'))).toEqual({ line: 2, col: 1 });
  });

  it('getNode on an alias returns the Alias node (not its target)', () => {
    const a = parseText(corpus('compose-anchors.yaml'));
    const n = getNode(a, { doc: 0, path: ['services', 'worker', 'environment'] });
    expect(isAlias(n)).toBe(true);
  });
});
