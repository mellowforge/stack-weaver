import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { reachedYamlImports } from '../../scripts/check-types.mjs';

describe('check-types reachedYamlImports', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'check-types-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const write = (path: string, body: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };

  it('follows export-from and import type specifiers transitively', () => {
    write('index.d.ts', "export * from './a.js';\nexport type { B } from './sub/b.js';\n");
    write('a.d.ts', "import type { C } from './c.js';\nexport interface A { c: C }\n");
    write('sub/b.d.ts', "export interface B { x: import('../deep.js').D }\n");
    write('c.d.ts', "import type { Document } from 'yaml';\nexport type C = Document;\n");
    write('deep.d.ts', "import { Pair } from 'yaml/util';\nexport type D = Pair;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'c.d.ts'), join(dir, 'deep.d.ts')]);
  });

  it('reports a reached file that imports from yaml, and not an unreached one', () => {
    write('index.d.ts', "export * from './a.js';\n");
    write('a.d.ts', "import type { Document } from 'yaml';\nexport type A = Document;\n");
    write('orphan.d.ts', "import type { Document } from 'yaml';\nexport type O = Document;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'a.d.ts')]);
  });

  it('ignores other bare packages and yaml-lookalike names', () => {
    write('index.d.ts', "import type { X } from 'yaml-other';\nimport type { Y } from 'ajv';\nexport type Z = X | Y;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([]);
  });

  it('handles cycles', () => {
    write('index.d.ts', "export * from './a.js';\n");
    write('a.d.ts', "export * from './b.js';\n");
    write('b.d.ts', "export * from './a.js';\nimport type { Document } from 'yaml';\nexport type B = Document;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'b.d.ts')]);
  });

  it('throws on an unresolved relative specifier, naming file and specifier', () => {
    write('index.d.ts', "export * from './missing.js';\n");
    expect(() => reachedYamlImports(join(dir, 'index.d.ts'))).toThrow(/index\.d\.ts imports \.\/missing\.js/);
  });

  it('resolves ./dir/index.js, extensionless and trailing-slash directory specifiers', () => {
    write('index.d.ts', "export * from './a/index.js';\nexport * from './b';\nexport * from './c/';\n");
    write('a/index.d.ts', "import type { D } from 'yaml';\nexport type A = D;\n");
    write('b.d.ts', "import 'yaml';\n");
    write('c/index.d.ts', "export * from '../e.js';\n");
    write('e.d.ts', "export type E = import('yaml').Document;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'a/index.d.ts'), join(dir, 'b.d.ts'), join(dir, 'e.d.ts')]);
  });

  it.each([
    ['inline type modifier', "import { type X } from 'yaml';\n"],
    ['side-effect import', "import 'yaml';\n"],
    ['multi-line export-from', "export {\n  A,\n  B\n} from 'yaml';\n"],
    ['inline import() type query', "export type T = typeof import(\"yaml\");\n"],
  ])('detects yaml via %s', (_name, body) => {
    write('index.d.ts', body);
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'index.d.ts')]);
  });

  it('ignores specifiers inside block and line comments', () => {
    write('index.d.ts', "/**\n * @example\n * import { parse } from 'yaml';\n */\n// import 'yaml';\nexport type A = 1;\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([]);
  });

  it('is string-aware: a glob string before a later block comment does not swallow imports', () => {
    write('index.d.ts', "export type G = 'src/*';\nexport * from './a.js';\n/** doc */\nexport type H = 1;\n");
    write('a.d.ts', "import 'yaml';\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'a.d.ts')]);
  });

  it('is string-aware: // inside a string does not drop the rest of the line', () => {
    write('index.d.ts', "export type S = 'a // b'; export * from './a.js';\n");
    write('a.d.ts', "import 'yaml';\n");
    expect(reachedYamlImports(join(dir, 'index.d.ts'))).toEqual([join(dir, 'a.d.ts')]);
  });

  const built = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/index.d.ts');
  it.skipIf(!existsSync(built))('today, dist reaches yaml imports (baseline for Task 2)', () => {
    expect(reachedYamlImports(built).length).toBeGreaterThan(0);
  });
});
