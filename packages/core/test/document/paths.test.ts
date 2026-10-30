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

  it('refAtOffset at column 1 after a block map selects the next key, not the map', () => {
    const t = 'metadata:\n  name: x\nspec:\n  a: 1\n';
    expect(refAtOffset(parseText(t), t.indexOf('spec'))).toEqual({ doc: 0, path: ['spec'] });
  });

  it('refAtOffset at column 1 after a block sequence selects the next key', () => {
    const t = 'l:\n  - a\n  - b\nm: 1\n';
    expect(refAtOffset(parseText(t), t.indexOf('m:'))).toEqual({ doc: 0, path: ['m'] });
  });

  it('refAtOffset at column 1 after a block scalar selects the next key', () => {
    const t = 'a: |\n  x\nb: 1\n';
    expect(refAtOffset(parseText(t), t.indexOf('b:'))).toEqual({ doc: 0, path: ['b'] });
  });

  it('refAtOffset at column 1 after a block map with CRLF line endings', () => {
    const t = 'metadata:\r\n  name: x\r\nspec:\r\n  a: 1\r\n';
    expect(refAtOffset(parseText(t), t.indexOf('spec'))).toEqual({ doc: 0, path: ['spec'] });
  });

  it('refAtOffset in a comment between documents returns undefined', () => {
    const t = 'a: 1\n# between\n---\nb: 2\n';
    const p = parseText(t);
    expect(refAtOffset(p, t.indexOf('between'))).toBeUndefined();
    expect(refAtOffset(p, t.indexOf('b:'))).toEqual({ doc: 1, path: ['b'] });
  });

  it('refAtOffset still selects the last scalar at the end of text without a final newline', () => {
    const t = 'a:\n  b: c';
    expect(refAtOffset(parseText(t), t.length)).toEqual({ doc: 0, path: ['a', 'b'] });
  });

  it('refAtOffset and toLineCol count UTF-16 units after an emoji', () => {
    const t = 'a: 🍵 x\nb: 🍵\nc: y\n';
    const p = parseText(t);
    expect(refAtOffset(p, t.indexOf('x'))).toEqual({ doc: 0, path: ['a'] });
    expect(toLineCol(p, t.indexOf('x'))).toEqual({ line: 1, col: 7 });
    expect(refAtOffset(p, t.indexOf('c:'))).toEqual({ doc: 0, path: ['c'] });
    expect(toLineCol(p, t.indexOf('y'))).toEqual({ line: 3, col: 4 });
  });

  it('refAtOffset reports a numeric map key as a string segment', () => {
    const t = 'data:\n  8080: default/web:80\n';
    const p = parseText(t);
    const ref = refAtOffset(p, t.indexOf('default'));
    expect(ref).toEqual({ doc: 0, path: ['data', '8080'] });
    expect((getNode(p, ref!) as { value: unknown }).value).toBe('default/web:80');
  });

  it('getNode on an alias returns the Alias node (not its target)', () => {
    const a = parseText(corpus('compose-anchors.yaml'));
    const n = getNode(a, { doc: 0, path: ['services', 'worker', 'environment'] });
    expect(isAlias(n)).toBe(true);
  });
});
