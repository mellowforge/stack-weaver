// Verifies the assembled site/dist: required files, base-prefixed absolute URLs,
// existing local references, and the inlined iframe URLs. Task 7 extends it for angular/.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteConfig } from '@stack-weaver/demo-kit';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const { base } = siteConfig(process.env);
const errors = [];
const fail = (msg) => errors.push(msg);

const pages = ['index.html', 'react/index.html'];
for (const file of [...pages, '.nojekyll']) {
  if (!existsSync(join(dist, file))) fail(`missing dist/${file}`);
}

const refPattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
for (const page of pages) {
  const path = join(dist, page);
  if (!existsSync(path)) continue;
  const html = readFileSync(path, 'utf8');
  for (const m of html.matchAll(refPattern)) {
    const ref = (m[1] ?? m[2]).split(/[?#]/)[0];
    if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) continue;
    let local;
    if (ref.startsWith('/')) {
      if (!ref.startsWith(base)) {
        fail(`${page}: "${ref}" does not start with base "${base}"`);
        continue;
      }
      local = join(dist, ref.slice(base.length));
    } else {
      local = resolve(dirname(path), ref);
    }
    // a bare directory reference resolves to its index.html
    if (!existsSync(local) && !existsSync(join(local, 'index.html'))) fail(`${page}: "${ref}" not found on disk`);
  }
}

const assetsDir = join(dist, 'assets');
const bundles = existsSync(assetsDir) ? readdirSync(assetsDir).filter((f) => f.endsWith('.js')) : [];
const bundleText = bundles.map((f) => readFileSync(join(assetsDir, f), 'utf8')).join('\n');
// The iframe src is assembled at runtime as `${site.base}${framework}/`; the base is
// inlined into the bundle through the __SITE__ define, so check that literal; the
// framework directories those URLs point at are checked above.
const escapedBase = base.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
if (!new RegExp(`base\\s*:\\s*["'\`]${escapedBase}["'\`]`).test(bundleText)) {
  fail(`landing JS bundle lacks the inlined site base "${base}"`);
}
for (const segment of ['react']) {
  if (!bundleText.includes(`\`${segment}\``) && !bundleText.includes(`"${segment}"`) && !bundleText.includes(`'${segment}'`)) {
    fail(`landing JS bundle lacks the "${segment}" iframe path segment`);
  }
}

if (errors.length) {
  console.error(`check-dist failed (base "${base}"):\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-dist ok (base "${base}")`);
