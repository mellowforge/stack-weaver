import { isEmptyDocument, toData } from '../document/data.js';
import { assertParsed } from '../document/internal.js';
import type { ParsedText } from '../document/types.js';
import type { DetectInput, FormatDefinition } from './types.js';

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
 * The {@link DetectInput} of `p`: `toData` per document, `undefined` for empty or unbuildable
 * ones, and no documents when the text does not parse.
 * @internal Shared by `detectFormat` and tests; not part of the public API.
 * @throws {TypeError} When `p` was not made by `parseText`.
 */
export function detectInputOf(p: ParsedText): DetectInput {
  assertParsed(p);
  const docs: unknown[] = [];
  if (p.ok) {
    for (let i = 0; i < p.docCount; i++) {
      let data: unknown;
      if (!isEmptyDocument(p, i)) {
        try {
          data = toData(p, i);
        } catch {
          data = undefined;
        }
      }
      docs.push(data);
    }
  }
  return { docs };
}

/**
 * Returns the first format whose `detect` accepts `p`; the documents are read once and handed to
 * every `detect`, which gets no documents when the text does not parse.
 * @param p - The parsed text.
 * @param formats - Formats to try, in order; defaults to the registered formats in registration order.
 * @throws {TypeError} When `p` was not made by `parseText`.
 */
export function detectFormat(p: ParsedText, formats?: readonly FormatDefinition[]): FormatDefinition | undefined {
  const input = detectInputOf(p);
  for (const f of formats ?? registry.values()) if (f.detect(input)) return f;
  return undefined;
}

/**
 * Clears all registrations.
 * @internal For tests only.
 */
export function resetFormats(): void {
  registry.clear();
}
