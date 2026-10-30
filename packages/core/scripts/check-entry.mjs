#!/usr/bin/env node
/**
 * Walks the static import graph of dist/index.js (relative specifiers only) and fails
 * if it reaches generated schemas or a format subpath. Prints the gzipped size of the graph.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const FORBIDDEN = ['/generated/', '/formats/kubernetes/', '/formats/compose/'];
const SPECIFIER = /(?:^|[;\s}])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g;

export function walkEntry(entry) {
  if (!existsSync(entry)) throw new Error(`${entry} not found. Run "pnpm build" first.`);
  const seen = new Set();
  const violations = [];
  const queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const posix = file.split(sep).join('/');
    if (FORBIDDEN.some((part) => posix.includes(part))) violations.push(posix);
    if (!existsSync(file)) {
      violations.push(`${posix} (unresolvable import)`);
      continue;
    }
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(SPECIFIER)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      queue.push(resolve(dirname(file), spec));
    }
  }
  const files = [...seen].sort();
  const gzip = gzipSync(Buffer.concat(files.filter((f) => existsSync(f)).map((f) => readFileSync(f)))).length;
  return { files, violations, gzip };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { files, violations, gzip } = walkEntry(resolve(root, 'dist/index.js'));
    for (const v of violations) console.error(`✗ entry graph reaches ${relative(root, v)}`);
    console.log(`entry graph: ${files.length} files, ${(gzip / 1024).toFixed(2)} kB gzip`);
    if (violations.length) process.exit(1);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
