#!/usr/bin/env node
/**
 * Walks the public type graph (relative specifiers from dist/index.d.ts through .d.ts files) and
 * fails if a reached file imports from `yaml`, so consumers never need yaml's types.
 * `--list` prints the offending files and exits 0.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPECIFIER =
  /(?:^|[;\s}])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
// Block comments, and line comments that start a line or follow whitespace (so 'http://' in a string survives).
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/gm;
const isYaml = (spec) => spec === 'yaml' || spec.startsWith('yaml/');

function resolveDts(from, spec) {
  const base = resolve(dirname(from), spec);
  const stem = base.replace(/\.[mc]?js$/, '');
  return [`${stem}.d.ts`, `${stem}.d.mts`, resolve(base, 'index.d.ts')].find((p) => existsSync(p));
}

/** Absolute paths of .d.ts files reachable from `entry` that import from `yaml`, sorted. */
export function reachedYamlImports(entry) {
  if (!existsSync(entry)) throw new Error(`${entry} not found. Run "pnpm build" first.`);
  const seen = new Set();
  const offenders = new Set();
  const queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8').replace(COMMENTS, '$1');
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1] ?? match[2];
      if (isYaml(spec)) offenders.add(file);
      else if (spec.startsWith('.')) {
        const target = resolveDts(file, spec);
        if (!target) throw new Error(`${file} imports ${spec}, which does not resolve to a .d.ts file`);
        queue.push(target);
      }
    }
  }
  return [...offenders].sort();
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const listOnly = process.argv.includes('--list');
    const offenders = reachedYamlImports(resolve(root, 'dist/index.d.ts'));
    for (const file of offenders) {
      const line = relative(root, file);
      if (listOnly) console.log(line);
      else console.error(`✗ public types import yaml: ${line}`);
    }
    if (!offenders.length) console.log('type graph: no yaml imports');
    if (offenders.length && !listOnly) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
