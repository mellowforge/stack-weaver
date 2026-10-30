import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkEntry } from '../../scripts/check-entry.mjs';

describe('check-entry walkEntry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-entry-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (path: string, body: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };

  it('accepts a graph of relative imports and other bare packages', () => {
    write('index.js', "import { a } from './a.js';\nimport 'yaml';\nexport { a };\n");
    write('a.js', 'export const a = 1;\n');
    expect(walkEntry(join(dir, 'index.js')).violations).toEqual([]);
  });

  it('flags a bare @codemirror/* import', () => {
    write('index.js', "import './a.js';\n");
    write('a.js', "import '@codemirror/view';\n");
    const { violations } = walkEntry(join(dir, 'index.js'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('@codemirror/view');
  });

  it('flags a bare @lezer/* import', () => {
    write('index.js', "import './a.js';\n");
    write('a.js', "import { tags } from '@lezer/highlight';\n");
    const { violations } = walkEntry(join(dir, 'index.js'));
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('@lezer/highlight');
  });

  it('flags a re-export from @codemirror/*', () => {
    write('index.js', "export { EditorView } from '@codemirror/view';\n");
    expect(walkEntry(join(dir, 'index.js')).violations).toHaveLength(1);
  });

  it('flags a relative import that reaches editors/', () => {
    write('index.js', "import './editors/codemirror/index.js';\n");
    write('editors/codemirror/index.js', 'export {};\n');
    expect(walkEntry(join(dir, 'index.js')).violations).toHaveLength(1);
  });
});
