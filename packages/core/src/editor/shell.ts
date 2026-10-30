import { h } from './dom.js';
import type { EditorMode } from './editor.js';
import type { UiMessages } from './messages.js';

/**
 * The editor's DOM frame: top bar and panes.
 * @internal
 */
export interface Shell {
  /** The `.sw-editor` root. */
  readonly root: HTMLElement;
  /** The `.sw-pane-visual` element. */
  readonly visualEl: HTMLElement;
  /** The `.sw-pane-code` element. */
  readonly codeEl: HTMLElement;
  /** The `.sw-recipes` element (starter recipes; hidden unless offered). */
  readonly recipesEl: HTMLElement;
  /** The `.sw-problems` element (the problems panel). */
  readonly problemsEl: HTMLElement;
  /** Sets the problem count text in the live region. */
  setProblemCount(text: string): void;
  /** Shows `mode`: updates the radio group and pane visibility. */
  setMode(mode: EditorMode): void;
  /** Sets `data-sw-theme`. */
  setTheme(theme: 'light' | 'dark'): void;
  /** Sets the format badge text. */
  setBadge(text: string): void;
  /** Enables or disables the undo and redo buttons. */
  setHistory(state: { canUndo: boolean; canRedo: boolean; readOnly: boolean }): void;
  /** Marks the editor read-only. */
  setReadOnly(readOnly: boolean): void;
}

const MODES: readonly EditorMode[] = ['visual', 'split', 'code'];

/** Builds the shell under `host`. */
export function createShell(
  host: HTMLElement,
  o: {
    ui: UiMessages;
    mode: EditorMode;
    theme: 'light' | 'dark';
    onMode(mode: EditorMode): void;
    onUndo(): void;
    onRedo(): void;
  },
): Shell {
  const doc = host.ownerDocument;
  const labels: Record<EditorMode, string> = { visual: o.ui.modeVisual, split: o.ui.modeSplit, code: o.ui.modeCode };

  const badge = h(doc, 'span', { class: 'sw-format-badge' });
  const radios = new Map<EditorMode, HTMLButtonElement>();
  const group = h(doc, 'div', { class: 'sw-mode-switch', role: 'radiogroup', 'aria-label': o.ui.modeLabel });
  for (const m of MODES) {
    const b = h(doc, 'button', { type: 'button', role: 'radio', class: 'sw-mode-radio', 'data-sw-mode': m }, [labels[m]]);
    b.addEventListener('click', () => o.onMode(m));
    b.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      const next = MODES[(MODES.indexOf(m) + step + MODES.length) % MODES.length] as EditorMode;
      o.onMode(next);
      radios.get(next)?.focus();
    });
    radios.set(m, b);
    group.append(b);
  }

  const undoBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-undo' }, [o.ui.undo]);
  const redoBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-redo' }, [o.ui.redo]);
  undoBtn.addEventListener('click', () => o.onUndo());
  redoBtn.addEventListener('click', () => o.onRedo());
  // A polite live region: screen readers hear the count change.
  const problemCount = h(doc, 'span', { class: 'sw-problem-count', role: 'status', 'aria-live': 'polite' });

  const topbar = h(doc, 'div', { class: 'sw-topbar' }, [badge, group, h(doc, 'div', { class: 'sw-history' }, [undoBtn, redoBtn]), problemCount]);
  const visualEl = h(doc, 'div', { class: 'sw-pane-visual', role: 'region', 'aria-label': o.ui.visualLabel });
  const codeEl = h(doc, 'div', { class: 'sw-pane-code' });
  const body = h(doc, 'div', { class: 'sw-body' }, [visualEl, codeEl]);
  const recipesEl = h(doc, 'div', { class: 'sw-recipes', hidden: true });
  const problemsEl = h(doc, 'section', { class: 'sw-problems', 'aria-label': o.ui.problemsLabel, hidden: true });
  const root = h(doc, 'div', { class: 'sw-editor', 'data-sw-theme': o.theme, 'aria-label': o.ui.editorLabel, role: 'group' }, [
    topbar,
    recipesEl,
    body,
    problemsEl,
  ]);
  host.replaceChildren(root);

  const shell: Shell = {
    root,
    visualEl,
    codeEl,
    recipesEl,
    problemsEl,
    setProblemCount: (text) => {
      problemCount.textContent = text;
    },
    setMode(mode) {
      root.setAttribute('data-sw-mode', mode);
      for (const [m, b] of radios) {
        b.setAttribute('aria-checked', String(m === mode));
        b.tabIndex = m === mode ? 0 : -1;
      }
      visualEl.hidden = mode === 'code';
      codeEl.hidden = mode === 'visual';
    },
    setTheme: (theme) => root.setAttribute('data-sw-theme', theme),
    setBadge: (text) => {
      badge.textContent = text;
    },
    setHistory({ canUndo, canRedo, readOnly }) {
      undoBtn.disabled = readOnly || !canUndo;
      redoBtn.disabled = readOnly || !canRedo;
    },
    setReadOnly(readOnly) {
      root.toggleAttribute('data-sw-readonly', readOnly);
    },
  };
  shell.setMode(o.mode);
  shell.setProblemCount(o.ui.problemsNone);
  return shell;
}
