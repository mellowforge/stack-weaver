import { toData } from '../document/data.js';
import type { ParsedText } from '../document/types.js';

/** True for a plain mapping (not an array, not null). */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** {@link toData} that returns `undefined` instead of throwing. */
export function safeData(p: ParsedText, doc: number): unknown {
  try {
    return toData(p, doc);
  } catch {
    return undefined;
  }
}
