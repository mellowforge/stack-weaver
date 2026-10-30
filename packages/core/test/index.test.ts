import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { VERSION } from '../src/index.js';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const FORBIDDEN = ['/generated/', '/formats/kubernetes/', '/formats/compose/'];

// Source-level twin of scripts/check-entry.mjs (which walks dist/): kept separate so the
// test needs no build output and no untyped .mjs import.
function entryGraph(entry: string): { files: string[]; violations: string[] } {
  const seen = new Set<string>();
  const queue = [entry];
  const re = /(?:^|[;\s}])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(re)) {
      const spec = m[1] as string;
      if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
    }
  }
  const files = [...seen];
  return { files, violations: files.filter((f) => !existsSync(f) || FORBIDDEN.some((p) => f.includes(p))) };
}

describe('@stack-weaver/core', () => {
  it('exports VERSION', () => {
    expect(VERSION).toBe('0.1.0');
  });

  it('main entry exports the documented names', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'DocumentStore', 'VERSION', 'addableAt', 'applyEdit', 'canEdit', 'detectFormat', 'diffText',
        'getFormat', 'getNode', 'guideField', 'kindCatalog', 'mergeGuide', 'parseText', 'refAtOffset',
        'registerFormat', 'resolveAt', 'toData', 'toLineCol', 'validateText',
      ].sort(),
    );
  });

  it('main entry module graph has no generated/ import', () => {
    const { files, violations } = entryGraph(`${src}index.ts`);
    expect(files.length).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});
