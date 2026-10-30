import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';
import { VERSION } from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));

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
    if (!existsSync(`${root}dist/index.js`)) throw new Error('dist/index.js is missing: run "pnpm build" first.');
    expect(() => execFileSync('node', [`${root}scripts/check-entry.mjs`], { stdio: 'pipe' })).not.toThrow();
  });
});
