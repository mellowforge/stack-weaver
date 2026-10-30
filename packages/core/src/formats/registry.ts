import type { ParsedText } from '../document/types.js';
import type { FormatDefinition } from './types.js';

const registry = new Map<string, FormatDefinition>();

/**
 * Registers a format. Registering the identical object again is a no-op, so a module may register
 * its format on every import; a different object with an id already in use throws.
 */
export function registerFormat(f: FormatDefinition): void {
  const existing = registry.get(f.id);
  if (existing === f) return;
  if (existing) throw new Error(`Format "${f.id}" is already registered`);
  registry.set(f.id, f);
}

/** Returns the format registered under `id`, if any. */
export function getFormat(id: string): FormatDefinition | undefined {
  return registry.get(id);
}

/**
 * Returns the first format whose `detect` accepts `p`.
 * @param p - The parsed text.
 * @param formats - Formats to try, in order; defaults to the registered formats in registration order.
 */
export function detectFormat(p: ParsedText, formats?: readonly FormatDefinition[]): FormatDefinition | undefined {
  for (const f of formats ?? registry.values()) if (f.detect(p)) return f;
  return undefined;
}

/**
 * Clears all registrations.
 * @internal For tests only.
 */
export function resetFormats(): void {
  registry.clear();
}
