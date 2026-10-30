// Pinned upstream schema sources, shared by gen-kubernetes.mjs and gen-compose.mjs.
//
// schema-sources.lock.json pins every source file by URL and sha256. A normal run only reads the
// lock: it throws when the entry is missing, pinned to another version, lacks a sha256, or lists
// unexpected files, and it accepts a download only when its sha256 matches. Only
// `--update-lock` lists, downloads and (re)pins the sources.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {Buffer | string} data */
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** True when the generator was run with `--update-lock`. */
export const updateLockRequested = () => process.argv.includes('--update-lock');

/** @param {string} lockPath */
export function readLock(lockPath) {
  return existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : {};
}

/**
 * The lock entry's files for `key`, verified against what the generator expects.
 * @param {Record<string, any>} lock
 * @param {{ key: string, version: string, urlOf: (name: string) => string, checkNames: (names: string[]) => void }} opts
 * @returns {Record<string, { url: string, sha256: string }>}
 */
export function lockedFiles(lock, { key, version, urlOf, checkNames }) {
  const hint = 'run the generator with --update-lock to (re)pin it';
  const entry = lock[key];
  if (!entry) throw new Error(`schema-sources.lock.json has no "${key}" entry; ${hint}`);
  if (entry.version !== version) {
    throw new Error(`schema-sources.lock.json pins ${key} ${entry.version}, but the generator wants ${version}; ${hint}`);
  }
  const files = entry.files;
  if (!files || typeof files !== 'object') throw new Error(`schema-sources.lock.json "${key}" has no files; ${hint}`);
  const names = Object.keys(files).sort();
  checkNames(names);
  for (const name of names) {
    const f = files[name];
    if (typeof f?.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
      throw new Error(`schema-sources.lock.json "${key}" pins no sha256 for ${name}; ${hint}`);
    }
    if (f.url !== urlOf(name)) {
      throw new Error(`schema-sources.lock.json "${key}" pins ${name} at ${f.url}, expected ${urlOf(name)}; ${hint}`);
    }
  }
  return files;
}

/**
 * Throws unless `names` is exactly `expected` (order-insensitive).
 * @param {string[]} names
 * @param {string[]} expected
 */
export function expectNames(names, expected) {
  const a = [...names].sort();
  const b = [...expected].sort();
  if (a.length !== b.length || a.some((n, i) => n !== b[i])) {
    throw new Error(`expected source files [${b.join(', ')}], got [${a.join(', ')}] (${a.length} vs ${b.length})`);
  }
}

/**
 * Runs `gh api <path>` and returns its stdout, or `undefined` when gh is not installed. Any other
 * failure (not logged in, rate limit, 404) throws with gh's stderr instead of silently falling
 * back to an unauthenticated request.
 * @param {string} path
 * @param {typeof execFileSync} [run]
 */
export function ghApi(path, run = execFileSync) {
  try {
    return run('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err?.code === 'ENOENT') return undefined;
    const stderr = String(err?.stderr ?? '').trim();
    throw new Error(`gh api ${path} failed${stderr ? `: ${stderr}` : ` (${err?.message ?? err})`}`);
  }
}

/**
 * Lists a GitHub contents API path with `gh`, or, when gh is not installed, with `fetch` (using
 * `GITHUB_TOKEN` when set). Throws unless the response is an array.
 * @param {string} path - e.g. `repos/<owner>/<repo>/contents/<dir>?ref=<tag>`.
 * @param {typeof execFileSync} [run]
 * @returns {Promise<Array<{ name?: unknown }>>}
 */
export async function listGithubDir(path, run = execFileSync) {
  const out = ghApi(path, run);
  let entries;
  if (out !== undefined) {
    entries = JSON.parse(out);
  } else {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'stack-weaver-gen' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/${path}`, { headers });
    if (!res.ok) throw new Error(`listing ${path} failed: ${res.status} ${res.statusText}`);
    entries = await res.json();
  }
  if (!Array.isArray(entries)) {
    throw new Error(`listing ${path} did not return an array: ${JSON.stringify(entries).slice(0, 200)}`);
  }
  return entries;
}

/** Parses `data` as JSON, so an HTML error page is never cached or pinned. */
function assertJson(name, data) {
  try {
    JSON.parse(data.toString('utf8'));
  } catch (err) {
    throw new Error(`${name} is not JSON (${err.message}); refusing to cache or pin it`);
  }
}

function writeAtomic(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Ensures every source is in `cacheDir` and returns the `{ url, sha256 }` map, sorted by name.
 * With `pinned` (verify mode), a cached file is used only when its sha256 matches; otherwise it is
 * downloaded, checked against the pin, and only then cached. Without `pinned` (update mode), every
 * file is downloaded fresh, parsed as JSON, cached, and its sha256 recorded.
 * @param {{ names: string[], cacheDir: string, urlOf: (name: string) => string,
 *           pinned?: Record<string, { sha256: string }>, concurrency?: number }} opts
 * @returns {Promise<Record<string, { url: string, sha256: string }>>}
 */
export async function syncSources({ names, cacheDir, urlOf, pinned, concurrency = 6 }) {
  mkdirSync(cacheDir, { recursive: true });
  const files = {};
  const queue = [...names];
  const worker = async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const path = join(cacheDir, name);
      const want = pinned?.[name]?.sha256;
      let data = pinned && existsSync(path) ? readFileSync(path) : undefined;
      if (data && sha256(data) !== want) data = undefined; // stale or corrupt cache
      if (!data) {
        data = await download(urlOf(name));
        assertJson(name, data);
        const got = sha256(data);
        if (pinned && got !== want) throw new Error(`sha256 mismatch for ${name}: lockfile ${want}, downloaded ${got}`);
        writeAtomic(path, data);
        console.log(`downloaded ${name} (${data.length} bytes)`);
      }
      files[name] = { url: urlOf(name), sha256: sha256(data) };
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return Object.fromEntries(Object.keys(files).sort().map((n) => [n, files[n]]));
}

/**
 * Writes (or replaces) the lock entry for `key`, keeping the other entries.
 * @param {string} lockPath
 * @param {string} key
 * @param {{ version: string, source: string, files: Record<string, { url: string, sha256: string }> }} entry
 */
export function writeLockEntry(lockPath, key, entry) {
  const next = { ...readLock(lockPath), [key]: entry };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  if (!existsSync(lockPath) || readFileSync(lockPath, 'utf8') !== text) {
    writeAtomic(lockPath, text);
    console.log(`wrote ${lockPath}`);
  }
}
