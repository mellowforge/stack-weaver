import { DocumentStore } from '../document/store.js';
import type { ChangeOrigin, StoreEvent } from '../document/store.js';
import type { NodeRef, TextRange } from '../document/types.js';
import type { CodeEditorAdapter } from '../editors/adapter.js';
import { mergeGuide } from '../formats/guide.js';
import type { FormatDefinition, Guide, GuideOverride, Recipe } from '../formats/types.js';
import type { SchemaMessages } from '../validation/messages.js';
import type { Problem } from '../validation/problems.js';
import { createCodePane } from './code-pane.js';
import { createBundleCache, loaders } from './context.js';
import type { EditorContext, Pane } from './context.js';
import { badgeText, loadBuiltinFormats, mergeFormats, resolveFormat } from './formats.js';
import { defaultUiMessages } from './messages.js';
import type { UiMessages } from './messages.js';
import { createProblemScheduler, problemCountText } from './problems.js';
import { createProblemsPanel } from './problems-panel.js';
import { createRecipeCards } from './recipes.js';
import { createShell } from './shell.js';
import { createVisualPane } from '../visual/visual-pane.js';

/** Which panes are shown: the form editor, both side by side, or the YAML code. */
export type EditorMode = 'visual' | 'split' | 'code';

/** Options for {@link createManifestEditor}. */
export interface ManifestEditorOptions {
  /** `'kubernetes'`, `'compose'`, the id of a host format, or `'auto'` to detect it from the text. Default `'auto'`. */
  format?: 'kubernetes' | 'compose' | 'auto' | (string & {});
  /** Initial YAML text. Default `''`. */
  value?: string;
  /** Initial mode. Default `'split'`. */
  mode?: EditorMode;
  /** Blocks user edits. Default `false`. */
  readOnly?: boolean;
  /** Colour scheme; `'auto'` follows `prefers-color-scheme`. Default `'auto'`. */
  theme?: 'light' | 'dark' | 'auto';
  /** The code editor. Default: the CodeMirror adapter, loaded on demand. */
  codeEditor?: CodeEditorAdapter;
  /** Extra formats; one with the id of a built-in replaces it. */
  formats?: readonly FormatDefinition[];
  /** Extra starter recipes, offered while the document is empty; one with the id of a built-in replaces it. */
  recipes?: readonly Recipe[];
  /** Guide overrides, keyed by format id. */
  guide?: Readonly<Record<string, GuideOverride>>;
  /** UI and schema message overrides. */
  messages?: { ui?: Partial<UiMessages>; schema?: Partial<SchemaMessages> };
  /** Called with the full text after every change, including undo and redo (`origin: 'history'`). */
  onChange?(value: string, meta: { origin: ChangeOrigin }): void;
  /** Called when the problems change. */
  onProblemsChange?(problems: readonly Problem[]): void;
  /** Called when the mode changes. */
  onModeChange?(mode: EditorMode): void;
}

/** A mounted manifest editor. */
export interface ManifestEditor {
  /** The current YAML text. */
  getValue(): string;
  /** Replaces the text (origin `'api'`); a no-op when it is equal. */
  setValue(text: string): void;
  /** The current mode. */
  getMode(): EditorMode;
  /** Switches mode. */
  setMode(mode: EditorMode): void;
  /** The current problems. */
  getProblems(): readonly Problem[];
  /** Blocks or allows user edits. */
  setReadOnly(readOnly: boolean): void;
  /** Undoes the latest step; false when there is none (or the editor is read-only). */
  undo(): boolean;
  /** Redoes the latest undone step; false when there is none (or the editor is read-only). */
  redo(): boolean;
  /** Scrolls to and selects the node. */
  reveal(ref: NodeRef): void;
  /** Resolves once the format is resolved and the code editor is mounted. */
  readonly ready: Promise<void>;
  /** Removes the editor from the page; no callback fires afterwards. */
  destroy(): void;
}

const EMPTY_GUIDE: Guide = { groups: [], kinds: {}, fields: {} };

/**
 * Creates the editor inside `el`. The DOM is built synchronously; the format and the code editor
 * resolve asynchronously (see {@link ManifestEditor.ready}).
 * @param el - The host element; its children are replaced.
 * @param options - See {@link ManifestEditorOptions}.
 */
export function createManifestEditor(el: HTMLElement, options: ManifestEditorOptions = {}): ManifestEditor {
  return createEditorWithContext(el, options).editor;
}

/**
 * {@link createManifestEditor} plus the internal context, for later tasks and tests.
 * @internal
 */
export function createEditorWithContext(
  el: HTMLElement,
  options: ManifestEditorOptions = {},
): { editor: ManifestEditor; ctx: EditorContext } {
  const win = el.ownerDocument.defaultView;
  const store = new DocumentStore(options.value ?? '');
  const ui: UiMessages = { ...defaultUiMessages, ...options.messages?.ui };
  const hostFormats = options.formats ?? [];
  const formatOption = options.format ?? 'auto';
  let destroyed = false;
  let readOnly = options.readOnly ?? false;
  let mode: EditorMode = options.mode ?? 'split';
  let format: FormatDefinition | undefined;
  let formatList: FormatDefinition[] = [...hostFormats];
  let formatsLoaded = false;
  let problems: readonly Problem[] = [];
  const problemListeners = new Set<(p: readonly Problem[]) => void>();

  // Theme: 'auto' follows prefers-color-scheme.
  const mq = options.theme === undefined || options.theme === 'auto' ? win?.matchMedia?.('(prefers-color-scheme: dark)') : undefined;
  const themeNow = (): 'light' | 'dark' =>
    options.theme === 'light' || options.theme === 'dark' ? options.theme : mq?.matches ? 'dark' : 'light';

  const cache = createBundleCache({ store, format: () => format, isDestroyed: () => destroyed });
  const ctx: EditorContext = {
    store,
    messages: { ui, schema: options.messages?.schema ?? {} },
    format: () => format,
    guide() {
      if (!format) return EMPTY_GUIDE;
      const override = options.guide?.[format.id];
      return override ? mergeGuide(format.guide, override) : format.guide;
    },
    readOnly: () => readOnly,
    problems: () => problems,
    bundleFor: cache.bundleFor,
    loadBundle: cache.loadBundle,
    bundleError: cache.bundleError,
    revealRange: (r: TextRange) => codePane.revealRange(r),
    select: (ref) => {
      codePane.reveal(ref);
      visualPane.reveal(ref);
    },
    onProblems(fn) {
      problemListeners.add(fn);
      return () => {
        problemListeners.delete(fn);
      };
    },
  };

  const shell = createShell(el, {
    ui,
    mode,
    theme: themeNow(),
    onMode: (m) => setMode(m),
    onUndo: () => undo(),
    onRedo: () => redo(),
  });

  const visualPane = createVisualPane(ctx, { el: shell.visualEl });
  const adapter: Promise<CodeEditorAdapter> = options.codeEditor ? Promise.resolve(options.codeEditor) : loaders.loadDefaultAdapter();
  const codePane = createCodePane(ctx, { el: shell.codeEl, adapter, theme: themeNow, onUndo: () => undo(), onRedo: () => redo() });
  const panes: Pane[] = [visualPane, codePane];

  const panel = createProblemsPanel(shell.problemsEl, { ui, onSelect: (p) => {
      // The code pane is hidden in visual mode: select the node in the outline instead.
      if (mode !== 'code') visualPane.reveal({ doc: p.doc, path: p.path });
      if (mode !== 'visual') ctx.revealRange({ from: p.from, to: p.to });
    },
  });
  const guarded = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.error('stack-weaver: a problems callback threw', err);
    }
  };
  const scheduler = createProblemScheduler(ctx, (next) => {
    problems = next;
    shell.setProblemCount(problemCountText(ui, next.length));
    panel.update(next);
    codePane.setProblems(next);
    for (const fn of [...problemListeners]) guarded(() => fn(next));
    if (options.onProblemsChange) guarded(() => options.onProblemsChange?.(next));
  });
  const recipes = createRecipeCards(ctx, {
    root: shell.recipesEl,
    auto: formatOption === 'auto',
    formats: () => (formatsLoaded ? formatList : []),
    hostRecipes: options.recipes ?? [],
    fixFormat: (f) => applyFormat(f),
    focusCode: () => codePane.instance()?.focus(),
  });

  const refreshHistory = (): void => shell.setHistory({ canUndo: store.canUndo, canRedo: store.canRedo, readOnly });

  function undo(): boolean {
    return !destroyed && !readOnly && store.undo();
  }
  function redo(): boolean {
    return !destroyed && !readOnly && store.redo();
  }
  function setMode(m: EditorMode): void {
    if (destroyed || m === mode) return;
    mode = m;
    shell.setMode(m);
    visualPane.refresh();
    options.onModeChange?.(m);
  }

  function applyFormat(next: FormatDefinition | undefined): void {
    if (next === format) return;
    format = next;
    cache.clear();
    shell.setBadge(next ? badgeText(next) : ui.formatNone);
    for (const p of panes) p.update(null);
    void scheduler.run(); // a new format means new problems, now rather than in 150 ms
    recipes.refresh();
  }
  shell.setBadge(ui.formatNone);

  const unsubscribe = store.subscribe((e: StoreEvent) => {
    if (destroyed) return;
    // Panes first: a format change re-syncs them, and they must already hold this change.
    for (const p of panes) p.update(e);
    if (formatOption === 'auto' && !format && formatsLoaded) applyFormat(resolveFormat('auto', store.parsed, formatList));
    scheduler.schedule();
    recipes.refresh();
    refreshHistory();
    options.onChange?.(e.text, { origin: e.origin });
  });

  // One undo history: Mod-z / Mod-Shift-z / Mod-y go to the store from anywhere except the code
  // pane, whose adapter already routes them (so one keypress is exactly one undo).
  const onKeydown = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const redoKey = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
    if (!redoKey && !(key === 'z' && !e.shiftKey)) return;
    if ((e.target as Element | null)?.closest?.('.sw-pane-code')) return;
    e.preventDefault();
    if (redoKey) redo();
    else undo();
  };
  shell.root.addEventListener('keydown', onKeydown, true);

  const onScheme = (): void => {
    shell.setTheme(themeNow());
    codePane.instance()?.setTheme(themeNow());
  };
  mq?.addEventListener?.('change', onScheme);

  const needBuiltins = formatOption === 'auto' || !hostFormats.some((f) => f.id === formatOption);
  const formatReady = (needBuiltins ? loadBuiltinFormats() : Promise.resolve([])).then((builtins) => {
    if (destroyed) return;
    formatList = mergeFormats(builtins, hostFormats);
    formatsLoaded = true;
    applyFormat(resolveFormat(formatOption, store.parsed, formatList));
    recipes.refresh(); // `applyFormat` does nothing when the format stays unresolved
  });
  // Ready also means the first validation has been published (or dropped by a destroy).
  const ready = Promise.all([formatReady, codePane.ready]).then(() => scheduler.run());

  refreshHistory();
  shell.setReadOnly(readOnly);

  const editor: ManifestEditor = {
    getValue: () => store.text,
    setValue(text) {
      if (!destroyed) store.setText(text, 'api');
    },
    getMode: () => mode,
    setMode,
    getProblems: () => problems,
    setReadOnly(v) {
      if (destroyed) return;
      readOnly = v;
      for (const p of panes) p.setReadOnly(v);
      shell.setReadOnly(v);
      recipes.refresh();
      refreshHistory();
    },
    undo,
    redo,
    reveal: (ref) => {
      if (!destroyed) ctx.select(ref);
    },
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      scheduler.destroy();
      shell.root.removeEventListener('keydown', onKeydown, true);
      mq?.removeEventListener?.('change', onScheme);
      for (const p of panes) p.destroy();
      problemListeners.clear();
      cache.clear();
      el.replaceChildren();
    },
  };
  return { editor, ctx };
}
