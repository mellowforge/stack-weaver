export type SiteTheme = 'auto' | 'light' | 'dark';

export const THEMES: readonly { readonly theme: SiteTheme; readonly label: string }[] = [
  { theme: 'auto', label: 'Auto' },
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
];

export const THEME_KEY = 'stack-weaver-site-theme';

const isTheme = (v: unknown): v is SiteTheme => v === 'auto' || v === 'light' || v === 'dark';

/** The stored page theme; `'auto'` when nothing valid is stored or the storage is unreadable. */
export function readTheme(storage?: Storage): SiteTheme {
  try {
    const v = (storage ?? localStorage).getItem(THEME_KEY);
    return isTheme(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

/** Stores the page theme; a storage that refuses the write is ignored. */
export function writeTheme(theme: SiteTheme, storage?: Storage): void {
  try {
    (storage ?? localStorage).setItem(THEME_KEY, theme);
  } catch {
    // storage unavailable (private mode, quota): the theme just does not persist
  }
}

/** Sets `data-theme` on `<html>`, or removes it for `'auto'` (the stylesheet then follows the OS). */
export function applyPageTheme(doc: Document, theme: SiteTheme): void {
  if (theme === 'auto') doc.documentElement.removeAttribute('data-theme');
  else doc.documentElement.setAttribute('data-theme', theme);
}
