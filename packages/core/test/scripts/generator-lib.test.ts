import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInto, upToDate } from '../../scripts/lib/output.mjs';
import { expectNames, ghApi, listGithubDir, lockedFiles, sha256, syncSources } from '../../scripts/lib/sources.mjs';

const urlOf = (n: string) => `https://example.test/v1/${n}`;
const JSON_BODY = '{"ok":true}';
const SHA = sha256(JSON_BODY);
const lock = (entry: unknown) => ({ other: { version: 'x' }, k: entry });
const opts = { key: 'k', version: 'v1', urlOf, checkNames: (n: string[]) => expectNames(n, ['a.json']) };

describe('lockedFiles (C1)', () => {
  it('returns the pinned files when the entry matches', () => {
    const files = { 'a.json': { url: urlOf('a.json'), sha256: SHA } };
    expect(lockedFiles(lock({ version: 'v1', files }), opts)).toEqual(files);
  });

  it('throws on a missing entry, another version, a missing sha256 or another url', () => {
    expect(() => lockedFiles({}, opts)).toThrow(/no "k" entry.*--update-lock/);
    expect(() => lockedFiles(lock({ version: 'v0', files: {} }), opts)).toThrow(/pins k v0, but the generator wants v1/);
    expect(() => lockedFiles(lock({ version: 'v1', files: { 'a.json': { url: urlOf('a.json') } } }), opts)).toThrow(
      /no sha256 for a.json/,
    );
    expect(() =>
      lockedFiles(lock({ version: 'v1', files: { 'a.json': { url: 'https://example.test/v0/a.json', sha256: SHA } } }), opts),
    ).toThrow(/expected https:\/\/example.test\/v1\/a.json/);
  });

  it('throws when the file list or count differs from the expected one', () => {
    const two = { 'a.json': { url: urlOf('a.json'), sha256: SHA }, 'b.json': { url: urlOf('b.json'), sha256: SHA } };
    expect(() => lockedFiles(lock({ version: 'v1', files: two }), opts)).toThrow(/expected source files \[a.json\], got \[a.json, b.json\] \(2 vs 1\)/);
    expect(() => lockedFiles(lock({ version: 'v1', files: {} }), opts)).toThrow(/expected source files/);
  });
});

describe('syncSources (C1)', () => {
  let dir: string;
  const fetchMock = vi.fn<(url: string) => Promise<Response>>();
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sw-sources-'));
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('uses a cached file whose sha256 matches the pin without downloading', async () => {
    writeFileSync(join(dir, 'a.json'), JSON_BODY);
    const files = await syncSources({ names: ['a.json'], cacheDir: dir, urlOf, pinned: { 'a.json': { sha256: SHA } } });
    expect(files).toEqual({ 'a.json': { url: urlOf('a.json'), sha256: SHA } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('re-downloads a stale cache and writes the cache only after the sha256 check passes', async () => {
    writeFileSync(join(dir, 'a.json'), '{"stale":1}');
    fetchMock.mockResolvedValue(new Response('{"tampered":1}'));
    await expect(
      syncSources({ names: ['a.json'], cacheDir: dir, urlOf, pinned: { 'a.json': { sha256: SHA } } }),
    ).rejects.toThrow(/sha256 mismatch for a.json/);
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('{"stale":1}');

    fetchMock.mockResolvedValue(new Response(JSON_BODY));
    await syncSources({ names: ['a.json'], cacheDir: dir, urlOf, pinned: { 'a.json': { sha256: SHA } } });
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe(JSON_BODY);
  });

  it('never caches or pins a response that is not JSON (an HTML error page)', async () => {
    fetchMock.mockResolvedValue(new Response('<html>rate limited</html>'));
    await expect(syncSources({ names: ['a.json'], cacheDir: dir, urlOf })).rejects.toThrow(/a.json is not JSON/);
    expect(existsSync(join(dir, 'a.json'))).toBe(false);
  });

  it('update mode downloads fresh, caches and records the sha256', async () => {
    writeFileSync(join(dir, 'a.json'), '{"old":1}');
    fetchMock.mockResolvedValue(new Response(JSON_BODY));
    const files = await syncSources({ names: ['a.json'], cacheDir: dir, urlOf });
    expect(files['a.json']!.sha256).toBe(SHA);
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe(JSON_BODY);
  });
});

describe('gh fallback (C2)', () => {
  const fail = (err: object) => () => {
    throw Object.assign(new Error('Command failed'), err);
  };
  afterEach(() => vi.unstubAllGlobals());

  it('returns undefined only when gh is not installed', () => {
    expect(ghApi('repos/x', fail({ code: 'ENOENT' }))).toBeUndefined();
    expect(ghApi('repos/x', () => '[]')).toBe('[]');
  });

  it('rethrows any other gh failure with its stderr', () => {
    expect(() => ghApi('repos/x', fail({ status: 1, stderr: 'HTTP 401: Bad credentials' }))).toThrow(
      /gh api repos\/x failed: HTTP 401: Bad credentials/,
    );
  });

  it('falls back to fetch without gh, and requires an array either way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"name":"a.json"}]')));
    await expect(listGithubDir('repos/x', fail({ code: 'ENOENT' }))).resolves.toEqual([{ name: 'a.json' }]);
    await expect(listGithubDir('repos/x', () => '{"message":"Not Found"}')).rejects.toThrow(/did not return an array/);
  });
});

describe('generateInto / upToDate (C3)', () => {
  let root: string;
  let out: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sw-output-'));
    out = join(root, 'src', 'generated');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const write = (dir: string) => {
    mkdirSync(join(dir, 'kinds'), { recursive: true });
    writeFileSync(join(dir, 'a.js'), 'a');
    writeFileSync(join(dir, 'kinds', 'b.js'), 'b');
  };

  it('stamps a manifest; upToDate needs the same input and every manifest file', () => {
    generateInto({ root, name: 't', outDir: out, input: 'h1', write });
    expect(JSON.parse(readFileSync(join(out, '.stamp'), 'utf8'))).toEqual({ input: 'h1', files: ['a.js', 'kinds/b.js'] });
    expect(upToDate(out, 'h1')).toBe(true);
    expect(upToDate(out, 'h2')).toBe(false);
    rmSync(join(out, 'kinds', 'b.js'));
    expect(upToDate(out, 'h1')).toBe(false);
  });

  it('a failing generation leaves the previous output untouched', () => {
    generateInto({ root, name: 't', outDir: out, input: 'h1', write });
    expect(() =>
      generateInto({
        root, name: 't', outDir: out, input: 'h2',
        write: (dir) => {
          writeFileSync(join(dir, 'half.js'), 'x');
          throw new Error('boom');
        },
      }),
    ).toThrow('boom');
    expect(upToDate(out, 'h1')).toBe(true);
    expect(existsSync(join(out, 'half.js'))).toBe(false);
  });

  it('a generation that writes nothing fails', () => {
    expect(() => generateInto({ root, name: 't', outDir: out, input: 'h', write: () => {} })).toThrow(/wrote no files/);
    expect(existsSync(out)).toBe(false);
  });
});
