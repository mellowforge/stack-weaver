// `pnpm test:smoke` builds first, then runs this: checks the built package loads in Node via its own exports.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

if (!existsSync(new URL('../dist/index.js', import.meta.url))) {
  console.error('smoke: dist/index.js is missing. Run `pnpm build` first (`pnpm test:smoke` does this for you).');
  process.exit(1);
}

const mod = await import('@stack-weaver/react');
assert.equal(typeof mod.ManifestEditor, 'function', 'ManifestEditor should be a function');

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(pkg.name, '@stack-weaver/react');
assert.deepEqual(
  pkg.peerDependencies,
  { '@stack-weaver/core': 'workspace:0.x', react: '^19.0.0', 'react-dom': '^19.0.0' },
  'peerDependencies should be exactly core, react and react-dom',
);
assert.equal(pkg.dependencies, undefined, 'there should be no runtime dependencies');
assert.ok(existsSync(new URL('../LICENSE', import.meta.url)), 'LICENSE should exist');
console.log('smoke ok: ManifestEditor, peers, no dependencies, LICENSE');
