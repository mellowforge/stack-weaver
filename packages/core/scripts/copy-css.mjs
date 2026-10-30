#!/usr/bin/env node
// Copies src/styles/stack-weaver.css to dist/stack-weaver.css (tsc does not copy CSS).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'src', 'styles', 'stack-weaver.css');
if (!existsSync(from)) {
  console.error(`copy-css: ${from} not found`);
  process.exit(1);
}
mkdirSync(join(root, 'dist'), { recursive: true });
copyFileSync(from, join(root, 'dist', 'stack-weaver.css'));
console.log('copy-css: dist/stack-weaver.css');
