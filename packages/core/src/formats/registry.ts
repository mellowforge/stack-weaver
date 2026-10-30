import type { ParsedText } from '../document/types.js';
import type { FormatDefinition } from './types.js';

const formats = new Map<string, FormatDefinition>();

/** Registers a format. Throws if a format with the same id is already registered. */
export function registerFormat(f: FormatDefinition): void {
  if (formats.has(f.id)) throw new Error(`Format "${f.id}" is already registered`);
  formats.set(f.id, f);
}

/** Returns the format registered under `id`, if any. */
export function getFormat(id: string): FormatDefinition | undefined {
  return formats.get(id);
}

/** Returns the first format (in registration order) whose `detect` accepts `p`. */
export function detectFormat(p: ParsedText): FormatDefinition | undefined {
  for (const f of formats.values()) if (f.detect(p)) return f;
  return undefined;
}

/**
 * Clears all registrations.
 * @internal For tests only.
 */
export function resetFormats(): void {
  formats.clear();
}
