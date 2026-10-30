#!/usr/bin/env node
// Copies generated schema modules (src/formats/<format>/generated/**/*.{js,d.ts,json}) into
// dist/formats/<format>/generated/, which it clears first so no stale chunk survives. tsc does not
// copy plain .js/.d.ts files, so `build` runs this before tsc, which then emits the compiled
// generated .ts files (loaders.ts) into the same directory. Fails when a format's generated
// directory is missing or nothing was copied.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const formatsSrc = join(root, 'src', 'formats');
const formatsDist = join(root, 'dist', 'formats');
const COPIED = /\.(js|d\.ts|json)$/;
/** Formats whose generated modules must exist (run the pre-scripts / generators first). */
const EXPECTED = ['kubernetes', 'compose'];

let copied = 0;
function copyTree(from, to) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dest);
    else if (entry.isFile() && COPIED.test(entry.name)) {
      mkdirSync(to, { recursive: true });
      copyFileSync(src, dest);
      copied++;
    }
  }
}

const missing = EXPECTED.filter((f) => !existsSync(join(formatsSrc, f, 'generated')));
if (missing.length > 0) {
  console.error(`copy-generated: missing src/formats/{${missing.join(',')}}/generated; run the schema generators first`);
  process.exit(1);
}
for (const format of readdirSync(formatsSrc, { withFileTypes: true })) {
  const generated = join(formatsSrc, format.name, 'generated');
  if (!format.isDirectory() || !existsSync(generated)) continue;
  const dest = join(formatsDist, format.name, 'generated');
  rmSync(dest, { recursive: true, force: true });
  copyTree(generated, dest);
}
if (copied === 0) {
  console.error('copy-generated: no generated files were copied');
  process.exit(1);
}
console.log(`copy-generated: ${copied} file(s) copied into dist/formats/*/generated/`);
