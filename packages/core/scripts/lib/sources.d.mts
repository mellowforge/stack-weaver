// Type declarations for sources.mjs (consumed by the TypeScript tests).
export interface PinnedFile {
  url: string;
  sha256: string;
}

export declare const sha256: (data: string | Uint8Array) => string;
export declare const updateLockRequested: () => boolean;
export declare function readLock(lockPath: string): Record<string, unknown>;
export declare function lockedFiles(
  lock: Record<string, unknown>,
  opts: { key: string; version: string; urlOf: (name: string) => string; checkNames: (names: string[]) => void },
): Record<string, PinnedFile>;
export declare function expectNames(names: string[], expected: string[]): void;
export declare function syncSources(opts: {
  names: string[];
  cacheDir: string;
  urlOf: (name: string) => string;
  pinned?: Record<string, { sha256: string }>;
  concurrency?: number;
}): Promise<Record<string, PinnedFile>>;
type Run = (cmd: string, args: string[], opts: object) => string;
export declare function ghApi(path: string, run?: Run): string | undefined;
export declare function listGithubDir(path: string, run?: Run): Promise<Array<{ name?: unknown }>>;
export declare function writeLockEntry(
  lockPath: string,
  key: string,
  entry: { version: string; source: string; files: Record<string, PinnedFile> },
): void;
