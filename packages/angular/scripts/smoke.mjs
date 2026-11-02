import '@angular/compiler'; // partial-compiled output needs the JIT linker outside a bundler
import { existsSync, readFileSync } from 'node:fs';

const dist = new URL('../dist/stack-weaver-angular/', import.meta.url);
const fail = (msg) => {
  console.error(`smoke FAILED: ${msg}`);
  process.exit(1);
};

const mod = await import(new URL('fesm2022/mellowforge-stack-weaver-angular.mjs', dist).href);
if (!('SwManifestEditor' in mod)) fail('missing export SwManifestEditor');

if (!existsSync(new URL('LICENSE', dist))) fail('dist/stack-weaver-angular/LICENSE is missing');

const pkg = JSON.parse(readFileSync(new URL('package.json', dist), 'utf8'));
if (pkg.name !== '@mellowforge/stack-weaver-angular') fail(`unexpected package name ${pkg.name}`);
const source = JSON.parse(readFileSync(new URL('../projects/stack-weaver-angular/package.json', import.meta.url), 'utf8'));
// The source ranges (`workspace:0.x` for the core); pnpm publish rewrites that one to 0.x
const expected = source.peerDependencies;
const actual = pkg.peerDependencies ?? {};
if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
  fail(`peerDependencies are ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
for (const [dep, range] of Object.entries(expected)) {
  if (actual[dep] !== range) fail(`peerDependencies[${dep}] is ${actual[dep]}, expected ${range}`);
}
if (pkg.dependencies && Object.keys(pkg.dependencies).some((d) => d !== 'tslib')) {
  fail(`unexpected dependencies ${JSON.stringify(pkg.dependencies)}`);
}

console.log('smoke ok:', Object.keys(mod).join(', '));
