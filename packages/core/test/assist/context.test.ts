import { describe, expect, it } from 'vitest';
import { cursorContext } from '../../src/assist/context.js';

/** Cursor at the last `|` in the string; that marker is removed from the text. */
function at(marked: string) {
  const offset = marked.lastIndexOf('|');
  const text = marked.slice(0, offset) + marked.slice(offset + 1);
  return cursorContext(text, offset);
}

/** Three containers; the cursor sits on a blank line inside the third (column 10). */
const DEPLOY = [
  'apiVersion: apps/v1',
  'kind: Deployment',
  'spec:',
  '  template:',
  '    spec:',
  '      containers:',
  '        - name: a',
  '          image: x',
  '        - name: b',
  '          image: y',
  '        - name: c',
  '          ',
].join('\n');

describe('cursorContext', () => {
  it('key at nested map', () => {
    expect(at('spec:\n  rep|')).toEqual({ doc: 0, path: ['spec'], position: 'key', prefix: 'rep', from: 8, indent: 2 });
  });

  it('key at the root', () => {
    expect(at('kin|')).toEqual({ doc: 0, path: [], position: 'key', prefix: 'kin', from: 0, indent: 0 });
  });

  it('blank line uses cursor column', () => {
    expect(at('spec:\n  replicas: 1\n  |')).toMatchObject({ path: ['spec'], position: 'key', prefix: '', indent: 2 });
    expect(at('spec:\n  template:\n    |')).toMatchObject({ path: ['spec', 'template'], prefix: '', indent: 4 });
  });

  it('sequence item index', () => {
    expect(cursorContext(DEPLOY, DEPLOY.length)).toMatchObject({
      path: ['spec', 'template', 'spec', 'containers', 2],
      position: 'key',
      prefix: '',
      indent: 10,
    });
  });

  it('a new sequence item gets the next index', () => {
    const t = DEPLOY.split('\n').slice(0, 10).join('\n') + '\n        - ';
    expect(cursorContext(t, t.length)).toMatchObject({ path: ['spec', 'template', 'spec', 'containers', 2], position: 'key', indent: 10 });
  });

  it('non-indented sequence', () => {
    expect(at('containers:\n- |')).toMatchObject({ path: ['containers', 0], position: 'key', indent: 2 });
    expect(at('containers:\n- name: a\n- na|')).toMatchObject({ path: ['containers', 1], prefix: 'na', indent: 2 });
    expect(at('containers:\n- name: a\n  ima|')).toMatchObject({ path: ['containers', 0], prefix: 'ima', indent: 2 });
  });

  it('nested keys under a dashed key line', () => {
    expect(at('- env:\n    na|')).toMatchObject({ path: [0, 'env'], indent: 4 });
  });

  it('value position', () => {
    expect(at('spec:\n  imagePullPolicy: If|')).toEqual({
      doc: 0,
      path: ['spec'],
      position: 'value',
      key: 'imagePullPolicy',
      prefix: 'If',
      from: 25,
      indent: 2,
    });
    expect(at('kind: |')).toMatchObject({ path: [], position: 'value', key: 'kind', prefix: '' });
  });

  it('value position inside a sequence item', () => {
    expect(at('items:\n  - name: a\n    pull: Al|')).toMatchObject({ path: ['items', 0], position: 'value', key: 'pull', prefix: 'Al' });
  });

  it('doc index counts --- markers', () => {
    expect(at('a: 1\n---\nki|')).toMatchObject({ doc: 1, path: [], prefix: 'ki' });
    expect(at('---\nki|')).toMatchObject({ doc: 0 });
    expect(at('# c\n---\nki|')).toMatchObject({ doc: 0 });
    expect(at('a: 1\n---\nb: 1\n---\nspec:\n  r|')).toMatchObject({ doc: 2, path: ['spec'] });
  });

  it('does not walk into a previous document', () => {
    expect(at('spec:\n  a: 1\n---\n  ki|')).toMatchObject({ doc: 1, path: [] });
  });

  it('inside block scalar returns undefined', () => {
    expect(at('data:\n  script: |\n    echo hi\n    ec|')).toBeUndefined();
    expect(at('args: >-\n  some te|')).toBeUndefined();
    expect(at('data:\n  script: |\n    echo\nnext|')).toMatchObject({ path: [] });
  });

  it('inside flow collection returns undefined', () => {
    expect(at('labels: {a: b, c|')).toBeUndefined();
    expect(at('args: [a, b|')).toBeUndefined();
    expect(at('args: [a,\n  b|')).toBeUndefined();
    expect(at('args: [a, b]\nkin|')).toMatchObject({ path: [] });
  });

  it('comment line returns undefined', () => {
    expect(at('# repl|')).toBeUndefined();
    expect(at('spec:\n  # repl|')).toBeUndefined();
  });

  it('skips comment and blank lines when finding ancestors', () => {
    expect(at('spec:\n\n  # note\n  a: 1\n  r|')).toMatchObject({ path: ['spec'] });
  });

  it('CRLF text gives the same results as LF', () => {
    const crlf = DEPLOY.replace(/\n/g, '\r\n');
    const { from: crlfFrom, ...crlfRest } = cursorContext(crlf, crlf.length)!;
    const { from: lfFrom, ...lfRest } = cursorContext(DEPLOY, DEPLOY.length)!;
    expect(crlfRest).toEqual(lfRest);
    expect(crlf.length - crlfFrom).toBe(DEPLOY.length - lfFrom);
    const v = 'spec:\r\n  imagePullPolicy: If';
    expect(cursorContext(v, v.length)).toMatchObject({ path: ['spec'], position: 'value', key: 'imagePullPolicy', prefix: 'If', from: v.length - 2 });
  });
});
