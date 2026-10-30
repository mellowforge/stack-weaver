import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';

const corpusDir = join(import.meta.dirname, '..', 'fixtures', 'corpus');
const corpus = (name: string): string => readFileSync(join(corpusDir, name), 'utf8');

describe('parseText', () => {
  it('multi-doc web app parses to 3 docs, ok', () => {
    const p = parseText(corpus('k8s-web-app.yaml'));
    expect(p.docs).toHaveLength(3);
    expect(p.ok).toBe(true);
    expect(p.errors).toEqual([]);
  });

  it('comment-only text parses to zero docs, ok', () => {
    const p = parseText(corpus('k8s-comment-only.yaml'));
    expect(p.docs).toHaveLength(0);
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

  it('keeps CRLF and missing trailing newline bytes in fixtures', () => {
    const crlf = corpus('k8s-web-app-crlf.yaml');
    expect(crlf).toContain('\r\n');
    expect(crlf.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(corpus('k8s-no-trailing-newline.yaml').endsWith('\n')).toBe(false);
  });
});
