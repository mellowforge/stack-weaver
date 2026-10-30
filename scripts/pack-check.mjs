#!/usr/bin/env node
/**
 * Packs every publishable package exactly as `pnpm publish` would and checks each
 * tarball: required files present, no sources, tests or scripts, no `workspace:`
 * specifier left in the packed package.json, and type declarations that resolve
 * (arethetypeswrong). Run after `pnpm build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// All packages are ESM-only (no `require` condition), so attw checks the ESM profile.
const PACKAGES = [
  {
    dir: 'packages/core',
    attw: ['--profile', 'esm-only'],
    required: ['dist/index.js', 'dist/index.d.ts'],
  },
];
const ALWAYS = ['package.json', 'README.md', 'LICENSE'];
const FORBIDDEN = [/^src\//, /^test\//, /^scripts\//, /^demo\//, /^examples\//, /\.spec\./, /\.test\./, /^tsconfig/];

const destination = mkdtempSync(join(tmpdir(), 'stack-weaver-pack-'));
let failures = 0;

try {
  for (const pkg of PACKAGES) {
    const output = execFileSync('pnpm', ['pack', '--json', '--pack-destination', destination], {
      cwd: pkg.dir,
      encoding: 'utf8',
    });
    const { name, version, filename, files } = JSON.parse(output);
    const paths = files.map((file) => file.path);
    const problems = [];

    for (const required of [...ALWAYS, ...pkg.required]) {
      if (!paths.includes(required)) problems.push(`missing ${required}`);
    }
    for (const path of paths) {
      if (FORBIDDEN.some((pattern) => pattern.test(path))) problems.push(`should not ship ${path}`);
    }
    const manifest = execFileSync('tar', ['-xOf', filename, 'package/package.json'], { encoding: 'utf8' });
    for (const [field, deps] of Object.entries(JSON.parse(manifest))) {
      if (!field.toLowerCase().includes('dependencies') || typeof deps !== 'object') continue;
      for (const [dep, range] of Object.entries(deps)) {
        if (String(range).startsWith('workspace:')) problems.push(`${field}.${dep} is still "${range}"`);
      }
    }

    try {
      execFileSync('pnpm', ['exec', 'attw', filename, '--format', 'ascii', ...pkg.attw], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error) {
      problems.push(`type declarations do not resolve:\n${error.stdout ?? error}`);
    }

    console.log(`${problems.length ? '✗' : '✓'} ${name}@${version} — ${paths.length} files`);
    for (const path of paths.sort()) console.log(`    ${path}`);
    for (const problem of problems) console.error(`    ✗ ${problem}`);
    failures += problems.length;
  }
} finally {
  rmSync(destination, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\npack:check found ${failures} problem(s).`);
  process.exit(1);
}
