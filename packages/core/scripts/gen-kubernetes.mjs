#!/usr/bin/env node
// Generates two lazy modules (schema, validator) per Kubernetes kind from the pinned upstream
// OpenAPI v3 spec. Downloads are cached in .cache/k8s/<tag>/ and pinned by sha256 in
// schema-sources.lock.json. Output: src/formats/kubernetes/generated/ (gitignored).
//
//   node scripts/gen-kubernetes.mjs [--force]
//
// Env: GITHUB_TOKEN (optional, for the api.github.com fallback when `gh` is unavailable),
//      SW_SKIP_BUDGET=1 (report but do not fail on chunks over the 60 kB gzip per-chunk budget).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitSchemaModules, gzipSize } from './lib/emit.mjs';
import { apiVersionOf, collectReachable, kindGvk, kindId, normalizeK8s, refsOf } from './lib/normalize-k8s.mjs';

const TAG = 'v1.37.2';
const REPO = 'kubernetes/kubernetes';
const SPEC_DIR = 'api/openapi-spec/v3';
const BUDGET = 60_000; // 60 kB (decimal, the stricter reading)
const LOCK_KEY = 'kubernetes';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'k8s', TAG);
const lockPath = join(root, 'schema-sources.lock.json');
const outDir = join(root, 'src', 'formats', 'kubernetes', 'generated');
const stampPath = join(outDir, '.stamp');
const force = process.argv.includes('--force');
const skipBudget = process.env.SW_SKIP_BUDGET === '1';

/** GA group-version files only: `api__v1_…` and `apis__<group>__v<N>_…` (no alpha/beta, no discovery). */
const GA_FILE = /^(?:api__v\d+|apis__[^_]+__v\d+)_openapi\.json$/;

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const rawUrl = (name) => `https://raw.githubusercontent.com/${REPO}/${TAG}/${SPEC_DIR}/${name}`;

async function listFiles() {
  const path = `repos/${REPO}/contents/${SPEC_DIR}?ref=${TAG}`;
  let entries;
  try {
    entries = JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'stack-weaver-gen' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/${path}`, { headers });
    if (!res.ok) throw new Error(`listing ${path} failed: ${res.status} ${res.statusText}`);
    entries = await res.json();
  }
  return entries.map((e) => e.name).filter((n) => GA_FILE.test(n)).sort();
}

async function download(name) {
  const res = await fetch(rawUrl(name));
  if (!res.ok) throw new Error(`download ${name} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Ensures every source file is cached and matches the lockfile; returns the locked file map. */
async function fetchSources() {
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
  const locked = lock[LOCK_KEY]?.version === TAG ? lock[LOCK_KEY].files : undefined;
  const names = locked ? Object.keys(locked).sort() : await listFiles();
  if (names.length === 0) throw new Error('no GA OpenAPI v3 files found');
  mkdirSync(cacheDir, { recursive: true });

  const files = {};
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const path = join(cacheDir, name);
      const want = locked?.[name]?.sha256;
      let data = existsSync(path) ? readFileSync(path) : undefined;
      if (!data || (want && sha256(data) !== want)) {
        data = await download(name);
        writeFileSync(path, data);
        console.log(`downloaded ${name} (${data.length} bytes)`);
      }
      const got = sha256(data);
      if (want && got !== want) throw new Error(`sha256 mismatch for ${name}: lockfile ${want}, downloaded ${got}`);
      files[name] = { url: rawUrl(name), sha256: got };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const sorted = Object.fromEntries(Object.keys(files).sort().map((n) => [n, files[n]]));
  const next = { ...lock, [LOCK_KEY]: { version: TAG, source: `https://github.com/${REPO}/tree/${TAG}/${SPEC_DIR}`, files: sorted } };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) {
    writeFileSync(lockPath, text);
    console.log(`wrote ${lockPath}`);
  }
  return sorted;
}

/** Hash of everything the output depends on, so unchanged inputs skip regeneration. */
function inputStamp(files) {
  const h = createHash('sha256');
  h.update(JSON.stringify(files));
  for (const f of ['scripts/gen-kubernetes.mjs', 'scripts/lib/normalize-k8s.mjs', 'scripts/lib/emit.mjs']) {
    h.update(readFileSync(join(root, f)));
  }
  for (const pkg of ['ajv', 'ajv-formats']) h.update(readFileSync(join(root, 'node_modules', pkg, 'package.json')));
  h.update(skipBudget ? 'skip-budget' : 'budget');
  return h.digest('hex');
}

function mergeComponents(files) {
  /** @type {Record<string, Record<string, unknown>>} */
  const all = {};
  for (const name of Object.keys(files)) {
    const spec = JSON.parse(readFileSync(join(cacheDir, name), 'utf8'));
    for (const [def, schema] of Object.entries(spec.components?.schemas ?? {})) all[def] ??= schema;
  }
  return all;
}

function generate(files) {
  const started = performance.now();
  const components = mergeComponents(files);
  const plain = normalizeK8s(components, { kindRoots: false });
  const rooted = normalizeK8s(components);
  const header = `// Generated by scripts/gen-kubernetes.mjs from Kubernetes ${TAG}. Do not edit.\n`;

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'kinds'), { recursive: true });

  const kinds = [];
  const seen = new Map();
  for (const defName of Object.keys(components).sort()) {
    const gvk = kindGvk(defName, components[defName]);
    if (!gvk) continue;
    const id = kindId(gvk);
    if (seen.has(id)) throw new Error(`duplicate kind ${id}: ${seen.get(id)} and ${defName}`);
    seen.set(id, defName);
    kinds.push({ id, apiVersion: apiVersionOf(gvk), kind: gvk.kind, defName, description: String(components[defName].description ?? '') });
  }
  kinds.sort((a, b) => a.id.localeCompare(b.id));

  const sizes = [];
  const warnings = new Set();
  for (const k of kinds) {
    // Rule 6 applies to this kind's root only; other kinds embedded in it (e.g. a
    // PersistentVolumeClaim in StatefulSet.volumeClaimTemplates) keep their plain shape.
    const $defs = { ...collectReachable(plain, k.defName), [k.defName]: rooted[k.defName] };
    for (const [name, def] of Object.entries($defs)) {
      if (name !== k.defName && refsOf(def).has(k.defName)) throw new Error(`${k.id}: root ${k.defName} is referenced from ${name}`);
    }
    const sortedDefs = Object.fromEntries(Object.keys($defs).sort().map((n) => [n, $defs[n]]));
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $ref: `#/$defs/${k.defName}`, $defs: sortedDefs };
    const mod = emitSchemaModules(schema, { header });
    for (const w of mod.warnings) warnings.add(w);
    for (const [suffix, js, dts] of [['schema', mod.schemaJs, mod.schemaDts], ['validate', mod.validateJs, mod.validateDts]]) {
      const file = `${k.id}.${suffix}.js`;
      writeFileSync(join(outDir, 'kinds', file), js);
      writeFileSync(join(outDir, 'kinds', `${k.id}.${suffix}.d.ts`), dts);
      sizes.push({ file, gzip: gzipSize(js), raw: Buffer.byteLength(js) });
    }
  }

  writeFileSync(join(outDir, 'kinds.json'), `${JSON.stringify(kinds, null, 2)}\n`);
  const entries = kinds
    .map((k) => {
      const imp = (suffix) => `import(${JSON.stringify(`./kinds/${k.id}.${suffix}.js`)})`;
      return `  ${JSON.stringify(k.id)}: () => Promise.all([${imp('schema')}, ${imp('validate')}]),`;
    })
    .join('\n');
  writeFileSync(
    join(outDir, 'loaders.ts'),
    `${header}
/** A generated kind schema chunk. */
export interface SchemaModule {
  schema: Record<string, unknown>;
}

/** A generated kind validator chunk: the precompiled ajv validator. */
export interface ValidateModule {
  validate: ((data: unknown) => boolean) & { errors?: unknown[] | null };
}

/** Lazy loaders for every generated kind, keyed by kind id; each loads two chunks in parallel. */
export const loaders: Record<string, () => Promise<[SchemaModule, ValidateModule]>> = {
${entries}
};
`,
  );

  const kb = (n) => `${(n / 1000).toFixed(1)} kB`;
  for (const s of sizes) {
    console.log(`${s.gzip > BUDGET ? 'OVER ' : '     '}${s.file.padEnd(80)} ${kb(s.gzip).padStart(9)} gzip  (raw ${kb(s.raw)})`);
  }
  if (warnings.size > 0) throw new Error(`ajv warnings:\n${[...warnings].join('\n')}`);
  const over = sizes.filter((s) => s.gzip > BUDGET);
  const largest = sizes.reduce((a, b) => (b.gzip > a.gzip ? b : a));
  console.log(
    `${kinds.length} kinds (${sizes.length} chunks) in ${((performance.now() - started) / 1000).toFixed(1)}s; largest ${largest.file} ${kb(largest.gzip)} gzip`,
  );
  if (over.length > 0) {
    const msg = `${over.length} chunk(s) over the ${kb(BUDGET)} gzip budget: ${over.map((s) => s.file).join(', ')}`;
    if (!skipBudget) throw new Error(msg);
    console.warn(`WARNING (SW_SKIP_BUDGET=1): ${msg}`);
  }
}

const files = await fetchSources();
const stamp = inputStamp(files);
if (!force && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === stamp && existsSync(join(outDir, 'loaders.ts'))) {
  console.log(`kubernetes ${TAG} schemas up to date (${Object.keys(files).length} source files); use --force to regenerate`);
} else {
  generate(files);
  writeFileSync(stampPath, stamp);
}
