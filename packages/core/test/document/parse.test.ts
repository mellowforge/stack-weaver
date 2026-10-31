import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toData } from '../../src/document/data.js';
import { describeNode } from '../../src/document/describe.js';
import { applyEdit, canEdit } from '../../src/document/edit.js';
import { getNode, lineCounterOf, yamlDocs } from '../../src/document/internal.js';
import { parseText } from '../../src/document/parse.js';
import { refAtOffset, toLineCol } from '../../src/document/paths.js';
import { composeFormat } from '../../src/formats/compose/index.js';
import { validateText } from '../../src/validation/validate.js';

const corpusDir = join(import.meta.dirname, '..', 'fixtures', 'corpus');
const corpus = (name: string): string => readFileSync(join(corpusDir, name), 'utf8');

describe('parseText', () => {
  it('multi-doc web app parses to 3 docs, ok', () => {
    const p = parseText(corpus('k8s-web-app.yaml'));
    expect(p.docCount).toBe(3);
    expect(yamlDocs(p)).toHaveLength(3);
    expect(p.ok).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('comment-only text parses to zero docs, ok', () => {
    const p = parseText(corpus('k8s-comment-only.yaml'));
    expect(p.docCount).toBe(0);
    expect(p.ok).toBe(true);
  });

  it('duplicate key yields ok=false with line/col', () => {
    const p = parseText('a: 1\nb: 2\nb: 3\n');
    expect(p.ok).toBe(false);
    expect(p.errors.length).toBeGreaterThan(0);
    const e = p.errors[0]!;
    expect(e.line).toBe(3);
    expect(e.col).toBe(1);
    expect(e.from).toBe(10);
  });

  it('a dangling alias makes ok false with a problem at the alias range', () => {
    const p = parseText('a: *nope\nb: 1\n');
    expect(p.ok).toBe(false);
    expect(p.errors).toEqual([
      { message: 'Unresolved alias “*nope” (no anchor “&nope” before it)', from: 3, to: 8, line: 1, col: 4 },
    ]);
  });

  it('an alias before its anchor is dangling; one after it resolves', () => {
    expect(parseText('a: *x\nb: &x 1\n').ok).toBe(false);
    expect(parseText('a: &x 1\nb: *x\n').ok).toBe(true);
  });

  it('collects YAML warnings without making ok false', () => {
    const p = parseText('name: !foo a\n');
    expect(p.ok).toBe(true);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatchObject({ from: 6, to: 10, line: 1, col: 7 });
    expect(p.warnings[0]!.message).toMatch(/Unresolved tag/);
    expect(parseText('a: 1\n').warnings).toEqual([]);
  });

  it('the handle and its errors and warnings are frozen, and still work with the API (R9)', () => {
    for (const text of ['name: !foo a\n', 'a: [\n']) {
      const p = parseText(text);
      expect(Object.isFrozen(p)).toBe(true);
      expect(Object.isFrozen(p.errors)).toBe(true);
      expect(Object.isFrozen(p.warnings)).toBe(true);
      expect(() => {
        (p as { text: string }).text = 'x';
      }).toThrow(TypeError);
    }
    const p = parseText('a: 1\n');
    expect(refAtOffset(p, 3)).toEqual({ doc: 0, path: ['a'] });
    expect(applyEdit(p, { op: 'set', at: { doc: 0, path: ['a'] }, value: 2 })).toMatchObject({ ok: true, text: 'a: 2\n' });
  });

  it('detects CRLF eol', () => {
    expect(parseText(corpus('k8s-web-app-crlf.yaml')).eol).toBe('\r\n');
    expect(parseText('a: 1\nb: 2\n').eol).toBe('\n');
    expect(parseText('a: 1').eol).toBe('\n');
  });

  it('every corpus file: parseText(text).text === text', () => {
    const files = readdirSync(corpusDir);
    expect(files.length).toBeGreaterThanOrEqual(20);
    for (const f of files) {
      const text = corpus(f);
      expect(parseText(text).text, f).toBe(text);
    }
  });

  it('every corpus file parses ok', () => {
    for (const f of readdirSync(corpusDir)) {
      expect(parseText(corpus(f)).ok, f).toBe(true);
    }
  });

  it('parseText exposes text, ok, docCount, errors, warnings and eol only', () => {
    const p = parseText('a: 1\n');
    expect(Object.keys(p).sort()).toEqual(['docCount', 'eol', 'errors', 'ok', 'text', 'warnings']);
    expect(JSON.parse(JSON.stringify(p))).toEqual({ text: 'a: 1\n', ok: true, docCount: 1, errors: [], warnings: [], eol: '\n' });
  });

  it('docCount counts documents, including empty ones between separators', () => {
    expect(parseText('a: 1\n---\n---\nb: 2\n').docCount).toBe(3);
    // A leading `---` opens the first document: nothing before it counts.
    expect(parseText('---\n---\na: 1\n').docCount).toBe(2);
    expect(parseText('').docCount).toBe(0);
  });

  it('the yaml internals are not enumerable and not string-keyed', () => {
    const p = parseText('a: 1\n---\nb: 2\n');
    expect(Object.getOwnPropertyNames(p).sort()).toEqual(['docCount', 'eol', 'errors', 'ok', 'text', 'warnings']);
    const symbols = Object.getOwnPropertySymbols(p);
    expect(symbols).toHaveLength(1);
    expect(Symbol.keyFor(symbols[0]!)).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(p, symbols[0]!)?.enumerable).toBe(false);
    expect(yamlDocs(p)).toHaveLength(2);
    expect(lineCounterOf(p).linePos(9)).toEqual({ line: 3, col: 1 });
  });

  it('internal helpers reject an object literal posing as ParsedText', () => {
    const fake = { ...parseText('a: 1\n') };
    const message = 'stack-weaver: not a ParsedText from parseText';
    expect(() => yamlDocs(fake)).toThrow(new TypeError(message));
    expect(() => lineCounterOf(fake)).toThrow(new TypeError(message));
    expect(() => getNode(fake, { doc: 0, path: ['a'] })).toThrow(new TypeError(message));
  });

  it('public functions given a copy of a ParsedText: readers throw, validateText rejects, edits refuse', async () => {
    const copy = { ...parseText('a: 1\n') };
    // A look-alike that claims to be broken must not slip through the ok-false shortcuts either.
    const broken = { text: 'a: [\n', ok: false, docCount: 1, errors: [], warnings: [], eol: '\n' } as const;
    const ref = { doc: 0, path: ['a'] };
    const typeError = new TypeError('stack-weaver: not a ParsedText from parseText');
    expect(() => toData(copy, 0)).toThrow(typeError);
    expect(() => describeNode(copy, ref)).toThrow(typeError);
    expect(() => refAtOffset(copy, 0)).toThrow(typeError);
    expect(() => toLineCol(copy, 0)).toThrow(typeError);
    await expect(validateText(copy, composeFormat)).rejects.toThrow(typeError);
    await expect(validateText(broken, composeFormat)).rejects.toThrow(typeError);
    for (const p of [copy, broken]) {
      expect(applyEdit(p, { op: 'set', at: ref, value: 2 })).toEqual({ ok: false, reason: 'unsupported' });
      expect(canEdit(p, ref)).toBe('unsupported');
    }
  });

  it('keeps CRLF and missing trailing newline bytes in fixtures', () => {
    const crlf = corpus('k8s-web-app-crlf.yaml');
    expect(crlf).toContain('\r\n');
    expect(crlf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(corpus('k8s-no-trailing-newline.yaml').endsWith('\n')).toBe(false);
  });
});
