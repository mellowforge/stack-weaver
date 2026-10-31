// Assembles site/dist: the landing page and the React entry (vite). Task 7 adds the Angular tab app.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteConfig } from '@stack-weaver/demo-kit';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { base } = siteConfig(process.env);

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (r.status !== 0) {
    console.error(`build failed: ${cmd} ${args.join(' ')} (${r.error?.message ?? `exit ${r.status}`})`);
    process.exit(r.status || 1);
  }
}

console.log(`Building site with base "${base}"`);
rmSync(dist, { recursive: true, force: true });

run('pnpm', ['exec', 'vite', 'build']);
if (!existsSync(join(dist, 'react/index.html'))) {
  console.error('build failed: vite did not emit dist/react/index.html');
  process.exit(1);
}

writeFileSync(join(dist, '.nojekyll'), '');
console.log('Site assembled in site/dist');
