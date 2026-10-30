#!/usr/bin/env node
// Copies generated schema modules (src/formats/<format>/generated/**/*.{js,d.ts,json}) into
// dist/formats/<format>/generated/. tsc compiles generated .ts files itself but does not copy
// plain .js/.d.ts files.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const formatsSrc = join(root, 'src', 'formats');
const formatsDist = join(root, 'dist', 'formats');
const COPIED = /\.(js|d\.ts|json)$/;

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

for (const format of readdirSync(formatsSrc, { withFileTypes: true })) {
  const generated = join(formatsSrc, format.name, 'generated');
  if (format.isDirectory() && existsSync(generated)) copyTree(generated, join(formatsDist, format.name, 'generated'));
}
console.log(`copy-generated: ${copied} file(s) copied into dist/formats/*/generated/`);
