// Type declarations for output.mjs (consumed by the TypeScript tests).
export declare function upToDate(outDir: string, input: string): boolean;
export declare function generateInto(opts: {
  root: string;
  name: string;
  outDir: string;
  input: string;
  write: (tmpDir: string) => void;
}): void;
