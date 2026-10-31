import { isEmptyDocument } from '../document/data.js';
import { DocumentStore } from '../document/store.js';
import type { ChangeOrigin, StoreEvent } from '../document/store.js';
import type { NodeRef, TextRange } from '../document/types.js';
import type { CodeEditorAdapter } from '../editors/adapter.js';
import { mergeGuide } from '../formats/guide.js';
import type { FormatDefinition, Guide, GuideOverride, Recipe, VariableDecl } from '../formats/types.js';
import type { SchemaMessages } from '../validation/messages.js';
import type { Problem } from '../validation/problems.js';
import { createCodePane } from './code-pane.js';
import { createBundleCache, loaders } from './context.js';
import type { EditorContext, Pane } from './context.js';
import { badgeText, mergeFormats, resolveFormat } from './formats.js';
import { defaultUiMessages } from './messages.js';
import type { UiMessages } from './messages.js';
import { createProblemScheduler, problemCountText } from './problems.js';
import { createProblemsPanel } from './problems-panel.js';
import { createRecipeCards } from './recipes.js';
import { createShell } from './shell.js';
import { createVariables } from './variables.js';
import type { VariablesOption } from './variables.js';
import type { EditorTheme, ResolvedTheme } from './theme.js';
import { createVisualPane } from '../visual/visual-pane.js';
import { defaultWidgets } from '../visual/widgets/registry.js';
import { createFieldSlots } from '../visual/widgets/field-row.js';
import type { WidgetRegistry } from '../visual/widgets/types.js';

/** Which panes are shown: the form editor, both side by side, or the YAML code. */
export type EditorMode = 'visual' | 'split' | 'code';

/** Message overrides: partial tables merged over {@link defaultUiMessages} and the default schema messages. */
export type EditorMessages = {
  /** The editor's own UI strings. */
  readonly ui?: Partial<UiMessages>;
  /** Validation messages. */
  readonly schema?: Partial<SchemaMessages>;
};

/**
 * Options for {@link createManifestEditor}.
 *
 * `value`, `mode`, `readOnly` and `theme` are initial values: change them later with
 * {@link ManifestEditor.setValue}, {@link ManifestEditor.setMode}, {@link ManifestEditor.setReadOnly}
 * and {@link ManifestEditor.setTheme}. The other options (`format`, `formats`, `guide`, `recipes`,
 * `widgets`, `messages`, `codeEditor`, `variables` and the callbacks) are read once, when the editor is created;
 * to change them, create a new editor.
 */
export interface ManifestEditorOptions {
  /** `'kubernetes'`, `'compose'`, the id of a host format, or `'auto'` to detect it from the text. Default `'auto'`. Init-only. */
  readonly format?: 'kubernetes' | 'compose' | 'auto' | (string & {});
  /** Initial YAML text. Default `''`. */
  readonly value?: string;
  /** Initial mode. Default `'split'`. */
  readonly mode?: EditorMode;
  /** Blocks user edits. Default `false`. */
  readonly readOnly?: boolean;
  /** Colour scheme; `'auto'` follows `prefers-color-scheme`. Default `'auto'`. */
  readonly theme?: EditorTheme;
  /** The code editor. Default: the CodeMirror adapter, loaded on demand. Init-only. */
  readonly codeEditor?: CodeEditorAdapter;
  /** Extra formats; one with the id of a built-in replaces it. Init-only. */
  readonly formats?: readonly FormatDefinition[];
  /** Extra starter recipes, offered while the document is empty; one with the id of a built-in replaces it. Init-only. */
  readonly recipes?: readonly Recipe[];
  /** Guide overrides, keyed by format id. Init-only. */
  readonly guide?: Readonly<Record<string, GuideOverride>>;
  /** Input widgets by name, merged over the built-in ones; a guide's `widget` names one of these. Init-only. */
  readonly widgets?: WidgetRegistry;
  /** UI and schema message overrides. Init-only. */
  readonly messages?: EditorMessages;
  /**
   * Called with the full text after every change, including undo and redo (`origin: 'history'`)
   * and {@link ManifestEditor.setValue} (`origin: 'api'`). A throw is logged and does not stop the editor.
   */
  readonly onChange?: (value: string, meta: { readonly origin: ChangeOrigin }) => void;
  /** Called when the problems change. A throw is logged and does not stop the editor. */
  readonly onProblemsChange?: (problems: readonly Problem[]) => void;
  /**
   * Called when the mode changes: by the mode switch, by {@link ManifestEditor.setMode}, and when an
   * "Edit in code" or "Jump to error" control opens Split from Visual. A throw is logged.
   */
  readonly onModeChange?: (mode: EditorMode) => void;
  /**
   * Where variable declarations live: `{ store: 'x-variables' }` (the default) keeps them in the
   * document's variables block; `{ store: 'external', value }` keeps them in a list the host owns
   * (change it with {@link ManifestEditor.setVariables}). Invalid initial declarations throw a
   * `TypeError`. Init-only.
   */
  readonly variables?: VariablesOption;
  /**
   * Called with the declarations when they change: by a text edit of the block, undo and redo, the
   * variable controls and quick fixes. Not called for {@link ManifestEditor.setVariables}. A throw is logged.
   */
  readonly onVariablesChange?: (decls: readonly VariableDecl[]) => void;
}

/** A mounted manifest editor. */
export interface ManifestEditor {
  /** The current YAML text. */
  getValue(): string;
  /** Replaces the text (origin `'api'`); a no-op (no `onChange`) when it is equal. */
  setValue(text: string): void;
  /** The current mode. */
  getMode(): EditorMode;
  /** Switches mode and calls `onModeChange`; a no-op (no `onModeChange`) when it is the current mode. */
  setMode(mode: EditorMode): void;
  /** The current problems. */
  getProblems(): readonly Problem[];
  /** Whether user edits are blocked. */
  getReadOnly(): boolean;
  /** Blocks or allows user edits. */
  setReadOnly(readOnly: boolean): void;
  /** Switches the colour scheme; `'auto'` follows `prefers-color-scheme` from now on. */
  setTheme(theme: EditorTheme): void;
  /** Undoes the latest step; false when there is none (or the editor is read-only). */
  undo(): boolean;
  /** Redoes the latest undone step; false when there is none (or the editor is read-only). */
  redo(): boolean;
  /** Scrolls to and selects the node. */
  reveal(ref: NodeRef): void;
  /** The declared variables: from the document's block, or the host's list for the `external` store; `[]` when there are none. */
  getVariables(): readonly VariableDecl[];
  /**
   * Replaces the declarations of an `external` store and re-validates; does not call
   * `onVariablesChange`. Throws a `TypeError` for an invalid declaration or a duplicate name. With
   * the `x-variables` store it warns and changes nothing.
   */
  setVariables(decls: readonly VariableDecl[]): void;
  /**
   * Applies the quick fix of `problem` (declaring a variable, or edits) as one undo step, all of it
   * or nothing. False, changing nothing, when the problem has no fix, the editor is read-only or
   * destroyed, or any of its edits is refused.
   */
  applyFix(problem: Problem): boolean;
  /**
   * Resolves once the format is resolved, the code editor is mounted and the first validation has
   * finished. Rejects if the code editor or built-in formats fail to load (the failure is also
   * shown in the editor). Does not resolve if a schema load never settles.
   */
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
 * {@link createManifestEditor} plus the internal context, for tests and internal wiring.
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
  /** Bumped by every store change and mode change, and by each focus request; see `focusField`. */
  let focusGen = 0;
  let readOnly = options.readOnly ?? false;
  let mode: EditorMode = options.mode ?? 'split';
  let format: FormatDefinition | undefined;
  let formatList: FormatDefinition[] = [...hostFormats];
  let formatsLoaded = false;
  let problems: readonly Problem[] = [];
  const problemListeners = new Set<(p: readonly Problem[]) => void>();

  // Created before any side effect (listeners, DOM): invalid initial declarations throw a TypeError here.
  const variables = createVariables({
    option: options.variables,
    store,
    format: () => format,
    readOnly: () => readOnly,
    isDestroyed: () => destroyed,
    onChange: (decls) => {
      if (options.onVariablesChange) guarded('an onVariablesChange callback', () => options.onVariablesChange?.(decls));
    },
    revalidate: () => void scheduler.run(), // the scheduler's staleness guard only sees text changes
  });

  // Theme: 'auto' follows prefers-color-scheme. The media query is watched while the theme is 'auto'.
  let theme: EditorTheme = options.theme ?? 'auto';
  let mq: MediaQueryList | undefined;
  const themeNow = (): ResolvedTheme => (theme !== 'auto' ? theme : mq?.matches ? 'dark' : 'light');
  /** Starts or stops following `prefers-color-scheme`. */
  const watchScheme = (on: boolean): void => {
    if (on && !mq) {
      mq = win?.matchMedia?.('(prefers-color-scheme: dark)');
      mq?.addEventListener?.('change', applyTheme);
    } else if (!on && mq) {
      mq.removeEventListener?.('change', applyTheme);
      mq = undefined;
    }
  };
  watchScheme(theme === 'auto');

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
    editInCode: (r: TextRange) => {
      if (destroyed) return;
      if (mode === 'visual') setMode('split'); // the code pane is hidden: show it next to the form
      codePane.revealRange(r);
      codePane.instance()?.focus();
    },
    select: (ref) => {
      codePane.reveal(ref);
      visualPane.reveal(ref);
    },
    focusField: (ref) => {
      // Anything the user does while the schema loads (typing, another mode, another recipe) makes
      // this focus stale: it is then dropped rather than stolen. `loadBundle` never rejects.
      const stamp = ++focusGen;
      void cache.loadBundle(ref.doc).then(() => {
        if (!destroyed && stamp === focusGen && mode !== 'code') visualPane.focusField(ref);
      });
    },
    onProblems(fn) {
      problemListeners.add(fn);
      return () => {
        problemListeners.delete(fn);
      };
    },
    variables: () => variables.store(),
    onVariables: (fn) => variables.on(fn),
    applyFix: (problem) => variables.applyFix(problem),
  };

  const shell = createShell(el, {
    ui,
    mode,
    theme: themeNow(),
    onMode: (m) => setMode(m),
    onUndo: () => undo(),
    onRedo: () => redo(),
  });

  const visualPane = createVisualPane(ctx, { el: shell.visualEl, slots: createFieldSlots(ctx, { ...defaultWidgets, ...options.widgets }) });
  const adapter: Promise<CodeEditorAdapter> = options.codeEditor ? Promise.resolve(options.codeEditor) : loaders.loadDefaultAdapter();
  const codePane = createCodePane(ctx, { el: shell.codeEl, adapter, theme: themeNow, onUndo: () => undo(), onRedo: () => redo() });
  const panes: Pane[] = [visualPane, codePane];

  const panel = createProblemsPanel(shell.problemsEl, { ui, onFix: (p) => ctx.applyFix(p),
    // The panel hid itself around the focus: the current mode's radio is always visible.
    restoreFocus: () => shell.root.querySelector<HTMLElement>(`.sw-mode-radio[data-sw-mode="${mode}"]`)?.focus(),
    onSelect: (p) => {
      // The code pane is hidden in visual mode: select the node in the outline instead.
      if (mode !== 'code') visualPane.reveal({ doc: p.doc, path: p.path });
      if (mode !== 'visual') ctx.revealRange({ from: p.from, to: p.to });
    },
  });
  /** Runs `fn`; a throw is logged as "stack-weaver: <what> threw" so the caller's own work goes on. */
  const guarded = (what: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.error(`stack-weaver: ${what} threw`, err);
    }
  };
  /** Updates every pane; one pane's failure must not keep the others (or `onChange`) from the change. */
  const updatePanes = (e: StoreEvent | null): void => {
    for (const p of panes) guarded(p === codePane ? 'the code pane' : 'the visual pane', () => p.update(e));
  };
  const scheduler = createProblemScheduler(ctx, (next) => {
    problems = next;
    shell.setProblemCount(problemCountText(ui, next.length));
    panel.update(next);
    codePane.setProblems(next);
    for (const fn of [...problemListeners]) guarded('a problems callback', () => fn(next));
    if (options.onProblemsChange) guarded('a problems callback', () => options.onProblemsChange?.(next));
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
    focusGen++;
    shell.setMode(m);
    guarded('the visual pane', () => visualPane.refresh());
    if (options.onModeChange) guarded('an onModeChange callback', () => options.onModeChange?.(m));
  }

  function applyFormat(next: FormatDefinition | undefined): void {
    if (next === format) return;
    format = next;
    cache.clear();
    shell.setBadge(next ? badgeText(next) : ui.formatNone);
    updatePanes(null);
    void scheduler.run(); // a new format means new problems: now, rather than after the debounce
    recipes.refresh();
  }
  shell.setBadge(ui.formatNone);

  const unsubscribe = store.subscribe((e: StoreEvent) => {
    if (destroyed) return;
    focusGen++;
    // Panes first: a format change re-syncs them, and they must already hold this change.
    updatePanes(e);
    if (formatOption === 'auto' && formatsLoaded) {
      const p = store.parsed;
      // Under `auto` the format follows the text: it is detected once there is some, and dropped when the text is
      // cleared (else the badge, guide and problems would keep describing a document that is gone). Broken text
      // keeps the last format, so typing through a syntax error does not flicker.
      if (!format) applyFormat(resolveFormat('auto', p, formatList));
      else if (p.ok && p.docs.every((_, i) => isEmptyDocument(p, i))) applyFormat(undefined);
    }
    scheduler.schedule();
    recipes.refresh();
    refreshHistory();
    if (options.onChange) guarded('an onChange callback', () => options.onChange?.(e.text, { origin: e.origin }));
    variables.check();
  });

  // One undo history: Mod-z / Mod-Shift-z / Mod-y go to the store from anywhere except the code
  // pane, whose adapter already routes them (so one keypress is exactly one undo).
  const onKeydown = (e: KeyboardEvent): void => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const redoKey = (key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey);
    if (!redoKey && !(key === 'z' && !e.shiftKey)) return;
    if ((e.target as Element | null)?.closest?.('.sw-pane-code, .sw-picker')) return;
    e.preventDefault();
    if (redoKey) redo();
    else undo();
  };
  shell.root.addEventListener('keydown', onKeydown, true);

  /** Shows the current theme on the root (`data-sw-theme`) and in the code editor. */
  function applyTheme(): void {
    if (destroyed) return;
    shell.setTheme(themeNow());
    guarded('the code editor', () => codePane.instance()?.setTheme(themeNow()));
  }

  const needBuiltins = formatOption === 'auto' || !hostFormats.some((f) => f.id === formatOption);
  const formatReady = (needBuiltins ? loaders.loadBuiltinFormats() : Promise.resolve([])).then(
    (builtins) => {
      if (destroyed) return;
      formatList = mergeFormats(builtins, hostFormats);
      formatsLoaded = true;
      applyFormat(resolveFormat(formatOption, store.parsed, formatList));
      variables.reseed(); // the declarations already in the text are not a change
      recipes.refresh(); // `applyFormat` does nothing when the format stays unresolved
    },
    (err: unknown) => {
      if (destroyed) return; // nobody is left to tell
      // Without formats the editor still edits text: say so where the format and the form would be.
      console.error('stack-weaver: loading the built-in formats failed', err);
      shell.setBadge(ui.formatsFailed);
      visualPane.setNotice(ui.formatsFailed);
      throw err;
    },
  );
  // Ready also means the first validation has been published (or dropped by a destroy). It runs
  // even when a load failed (the failure is already shown), and `ready` then rejects with it.
  const ready = Promise.allSettled([formatReady, codePane.ready]).then(async (results) => {
    await scheduler.run();
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failure) throw failure.reason;
  });
  // Hosts that never await `ready` must not get an unhandled rejection: the failure was shown and logged.
  ready.catch(() => {});

  refreshHistory();
  shell.setReadOnly(readOnly);
  panel.setReadOnly(readOnly);

  const editor: ManifestEditor = {
    getValue: () => store.text,
    setValue(text) {
      if (!destroyed) store.setText(text, 'api');
    },
    getMode: () => mode,
    setMode,
    getProblems: () => problems,
    getReadOnly: () => readOnly,
    setTheme(t) {
      if (destroyed) return;
      theme = t;
      watchScheme(t === 'auto');
      applyTheme();
    },
    setReadOnly(v) {
      if (destroyed) return;
      readOnly = v;
      for (const p of panes) p.setReadOnly(v);
      shell.setReadOnly(v);
      panel.setReadOnly(v);
      recipes.refresh();
      refreshHistory();
    },
    undo,
    redo,
    reveal: (ref) => {
      if (!destroyed) ctx.select(ref);
    },
    getVariables: () => variables.get(),
    setVariables: (decls) => variables.setAll(decls),
    applyFix: (problem) => !destroyed && variables.applyFix(problem),
    ready,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      variables.destroy();
      unsubscribe();
      scheduler.destroy();
      shell.root.removeEventListener('keydown', onKeydown, true);
      watchScheme(false);
      for (const p of panes) p.destroy();
      problemListeners.clear();
      cache.clear();
      el.replaceChildren();
    },
  };
  return { editor, ctx };
}
