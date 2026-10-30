// Generated-output bookkeeping shared by the schema generators: a stamp with the input hash and a
// manifest of the files written, and generation into a temporary directory that replaces the
// output directory only once generation has succeeded.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const STAMP = '.stamp';

/**
 * True when `outDir`'s stamp records `input` and every file in its manifest exists.
 * @param {string} outDir
 * @param {string} input
 */
export function upToDate(outDir, input) {
  try {
    const stamp = JSON.parse(readFileSync(join(outDir, STAMP), 'utf8'));
    return (
      stamp.input === input &&
      Array.isArray(stamp.files) &&
      stamp.files.length > 0 &&
      stamp.files.every((f) => typeof f === 'string' && existsSync(join(outDir, f)))
    );
  } catch {
    return false;
  }
}

/**
 * Runs `write(tmpDir)` in a fresh temporary directory under `<root>/.cache/tmp/`, then writes the
 * stamp (input hash plus a manifest of every file written) and moves the directory into place,
 * replacing `outDir`. If `write` throws, `outDir` is left untouched.
 * @param {{ root: string, name: string, outDir: string, input: string, write: (tmpDir: string) => void }} opts
 */
export function generateInto({ root, name, outDir, input, write }) {
  const tmpDir = join(root, '.cache', 'tmp', `${name}-generated`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  write(tmpDir);
  const files = listFiles(tmpDir).map((f) => relative(tmpDir, f).split('\\').join('/')).sort();
  if (files.length === 0) throw new Error(`${name}: generation wrote no files`);
  writeFileSync(join(tmpDir, STAMP), `${JSON.stringify({ input, files }, null, 2)}\n`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(dirname(outDir), { recursive: true });
  renameSync(tmpDir, outDir);
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
  );
}
