import type { ParsedText } from '../document/types.js';
import { detectFormat } from '../formats/registry.js';
import type { FormatDefinition } from '../formats/types.js';

/**
 * Loads the built-in formats. Reached only through dynamic `import()` so the main entry never
 * statically pulls in the generated schema data.
 */
export async function loadBuiltinFormats(): Promise<FormatDefinition[]> {
  const [k8s, compose] = await Promise.all([import('../formats/kubernetes/index.js'), import('../formats/compose/index.js')]);
  return [k8s.kubernetesFormat, compose.composeFormat];
}

/** The ids of the built-in formats, known before they load (they must match {@link loadBuiltinFormats}). */
export const BUILTIN_FORMAT_IDS: readonly string[] = Object.freeze(['kubernetes', 'compose']);

/** True when resolving `option` needs the built-in formats: `'auto'`, or an id no host format has. */
export function needsBuiltins(option: string, host: readonly FormatDefinition[]): boolean {
  return option === 'auto' || !host.some((f) => f.id === option);
}

/** Merges host formats over built-ins by id: a host format replaces a built-in with the same id and goes first. */
export function mergeFormats(builtins: readonly FormatDefinition[], host: readonly FormatDefinition[]): FormatDefinition[] {
  const ids = new Set(host.map((f) => f.id));
  return [...host, ...builtins.filter((f) => !ids.has(f.id))];
}

/**
 * Resolves the format: an explicit id picks that format; `'auto'` detects it from the text.
 * `undefined` is a valid result (empty text, or an unknown id).
 */
export function resolveFormat(option: string, parsed: ParsedText, formats: readonly FormatDefinition[]): FormatDefinition | undefined {
  if (option === 'auto') return detectFormat(parsed, formats);
  return formats.find((f) => f.id === option);
}

/** The badge text of a format: its label and schema version. */
export function badgeText(f: FormatDefinition): string {
  return `${f.label} ${f.version}`;
}
