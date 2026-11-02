import { THEMES, THEME_KEY, applyPageTheme, readTheme, writeTheme } from 'stack-weaver-demo-kit';
import type { SiteTheme } from 'stack-weaver-demo-kit';

const listeners = new Set<(theme: SiteTheme) => void>();

/** Stores the theme, applies it to this page and tells every watcher. Other frames hear it through `storage`. */
export function setSiteTheme(theme: SiteTheme): void {
  writeTheme(theme);
  applyPageTheme(document, theme);
  for (const fn of [...listeners]) fn(theme);
}

/**
 * Calls `fn` with the theme whenever it changes: here (`setSiteTheme`) or in another frame of the site (a `storage`
 * event, which also applies it to this page). `signal` removes the watcher.
 */
export function watchTheme(fn: (theme: SiteTheme) => void, signal: AbortSignal): void {
  listeners.add(fn);
  signal.addEventListener('abort', () => listeners.delete(fn), { once: true });
  window.addEventListener(
    'storage',
    (e) => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      const theme = readTheme();
      applyPageTheme(document, theme);
      fn(theme);
    },
    { signal },
  );
}

let instance = 0;

/**
 * The Auto / Light / Dark control: a WAI-ARIA radio group with roving tabindex. It keeps itself in step with the
 * stored theme and with every other switch on the page.
 */
export function createThemeSwitch(signal: AbortSignal): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Theme');
  group.id = `theme-switch-${++instance}`;
  const radios = THEMES.map((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'segmented__option';
    b.textContent = t.label;
    b.setAttribute('role', 'radio');
    return b;
  });
  group.append(...radios);

  const mark = (theme: SiteTheme): void => {
    THEMES.forEach((t, i) => {
      radios[i]!.setAttribute('aria-checked', String(t.theme === theme));
      radios[i]!.tabIndex = t.theme === theme ? 0 : -1;
    });
  };
  const choose = (index: number, focus: boolean): void => {
    setSiteTheme(THEMES[index]!.theme);
    if (focus) radios[index]!.focus();
  };

  radios.forEach((r, i) => r.addEventListener('click', () => choose(i, false), { signal }));
  group.addEventListener(
    'keydown',
    (e) => {
      const from = radios.indexOf(e.target as HTMLButtonElement);
      if (from < 0) return;
      const n = radios.length;
      let to: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          to = (from + 1) % n;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          to = (from + n - 1) % n;
          break;
        case 'Home':
          to = 0;
          break;
        case 'End':
          to = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      choose(to, true);
    },
    { signal },
  );

  mark(readTheme());
  watchTheme(mark, signal);
  return group;
}
