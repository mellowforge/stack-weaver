/** A colour scheme the editor surface is drawn in. */
export type ResolvedTheme = 'light' | 'dark';

/** The editor's colour scheme option: a fixed scheme, or `'auto'` to follow `prefers-color-scheme`. */
export type EditorTheme = ResolvedTheme | 'auto';
