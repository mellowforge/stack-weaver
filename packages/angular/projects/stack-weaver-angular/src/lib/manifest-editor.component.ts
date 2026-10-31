import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  afterNextRender,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  untracked,
} from '@angular/core';
import { createManifestEditor } from '@stack-weaver/core';
import type {
  CodeEditorAdapter,
  EditorMessages,
  EditorMode,
  EditorTheme,
  FormatDefinition,
  ManifestEditorController,
  ManifestEditorOptions,
  ManifestEditorUpdate,
  Problem,
  Recipe,
  VariableDecl,
  VariablesOption,
  WidgetRegistry,
} from '@stack-weaver/core';

/** The init-only inputs, and the variables store kind: a change to any of them recreates the editor. */
interface InitOnly {
  readonly codeEditor: CodeEditorAdapter | undefined;
  readonly formats: readonly FormatDefinition[] | undefined;
  readonly recipes: readonly Recipe[] | undefined;
  readonly guide: ManifestEditorOptions['guide'];
  readonly widgets: WidgetRegistry | undefined;
  readonly messages: EditorMessages | undefined;
  readonly store: VariablesOption['store'];
}

/** The settable inputs other than `variables`; also what a recreated editor starts from (the old one's state). */
interface Settable {
  readonly value: string;
  readonly mode: EditorMode;
  readonly format: string;
  readonly readOnly: boolean;
  readonly theme: EditorTheme;
}

type Patch = { -readonly [K in keyof ManifestEditorUpdate]: ManifestEditorUpdate[K] };

const sameInit = (a: InitOnly, b: InitOnly): boolean =>
  (Object.keys(a) as (keyof InitOnly)[]).every((k) => a[k] === b[k]);

/**
 * The `@stack-weaver/core` manifest editor as an Angular component. The host element is the editor's container;
 * the core builds the editor inside it after the first render, so it is safe for server rendering.
 *
 * Settable inputs (`value`, `mode`, `format`, `readOnly`, `theme`, and `variables.value` with the `external` store)
 * are pushed to the editor when they change. Init-only inputs (`codeEditor`, `formats`, `recipes`, `guide`,
 * `widgets`, `messages`, and the `variables` store kind) recreate the editor when their reference changes, which
 * keeps the text, mode, format, read-only state and theme but loses the undo history: pass stable objects.
 *
 * The editor's DOM listeners run outside the Angular zone; its callbacks re-enter it, so the component works with
 * and without zone.js.
 */
@Component({
  selector: 'sw-manifest-editor',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: block' },
})
export class SwManifestEditor {
  /**
   * The YAML text, two-way (`[(value)]`). Written on every edit: typing, the form, undo and redo, and controller
   * calls such as `setValue`. A new `value` is pushed only when it differs from the last one the editor reported
   * and from its text, so a parent that binds it one way never reverts the user's typing. A pushed value is not
   * written back.
   */
  readonly value = model<string>('');
  /** The mode, two-way (`[(mode)]`). Pushed as `value` is. */
  readonly mode = model<EditorMode>('split');
  /** The format option: `'auto'` or a format id. The editor never changes it; see `activeFormatChange`. */
  readonly format = input<string>('auto');
  /** Blocks user edits; also accepts a static attribute (`readOnly`). */
  readonly readOnly = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Colour scheme; `'auto'` follows `prefers-color-scheme`. */
  readonly theme = input<EditorTheme>('auto');
  /**
   * Where variable declarations live (default: the `x-variables` store). The store kind is init-only; with the
   * `external` store, a new `value` array is pushed (compared by reference).
   */
  readonly variables = input<VariablesOption | undefined>();
  /** The code editor. Default: the CodeMirror adapter, loaded on demand. Init-only. */
  readonly codeEditor = input<CodeEditorAdapter | undefined>();
  /** Extra formats. Init-only. */
  readonly formats = input<readonly FormatDefinition[] | undefined>();
  /** Extra starter recipes. Init-only. */
  readonly recipes = input<readonly Recipe[] | undefined>();
  /** Guide overrides, keyed by format id. Init-only. */
  readonly guide = input<ManifestEditorOptions['guide'] | undefined>();
  /** Input widgets by name. Init-only. */
  readonly widgets = input<WidgetRegistry | undefined>();
  /** UI and schema message overrides. Init-only. */
  readonly messages = input<EditorMessages | undefined>();

  /** The problems, when they change. */
  readonly problemsChange = output<readonly Problem[]>();
  /** The declarations, when an edit changes them; not for a pushed `variables.value`. */
  readonly variablesChange = output<readonly VariableDecl[]>();
  /** The resolved format id (`undefined` for none) when it changes, including once when it first resolves. */
  readonly activeFormatChange = output<string | undefined>();
  /** `canUndo` or `canRedo` changed. */
  readonly historyChange = output<{ canUndo: boolean; canRedo: boolean }>();

  private readonly zone = inject(NgZone);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private editor?: ManifestEditorController;
  /** The init-only inputs the live editor was created with. */
  private createdWith?: InitOnly;
  /** The settable inputs last seen by the push effect (or at creation). */
  private prev?: Settable;
  /** The text and mode the wrapper last saw: from the editor's callbacks, or as the input it pushed or skipped. */
  private lastValue = '';
  private lastMode: EditorMode = 'split';
  /** The `external` declarations last handed to the editor. */
  private appliedVariables?: readonly VariableDecl[];
  /** Set while the wrapper's own `update()` runs: its `onChange` is an echo of an input. */
  private pushing = false;

  private readonly initOnly = computed<InitOnly>(
    () => ({
      codeEditor: this.codeEditor(),
      formats: this.formats(),
      recipes: this.recipes(),
      guide: this.guide(),
      widgets: this.widgets(),
      messages: this.messages(),
      store: this.variables()?.store ?? 'x-variables',
    }),
    { equal: sameInit },
  );

  constructor() {
    afterNextRender(() => {
      this.lastValue = untracked(this.value);
      this.lastMode = untracked(this.mode);
      this.create();
    });
    inject(DestroyRef).onDestroy(() => {
      const ed = this.editor;
      this.editor = undefined;
      if (ed) this.zone.runOutsideAngular(() => ed.destroy());
    });

    // A changed init-only input recreates the editor (the first run is before it exists).
    effect(() => {
      const init = this.initOnly();
      untracked(() => {
        if (this.editor && init !== this.createdWith) this.recreate();
      });
    });

    // The settable inputs that changed, in one update(). Every signal is read before the editor check, so the
    // effect tracks them all from its first run, which comes before the editor exists.
    effect(() => {
      const now: Settable = {
        value: this.value(),
        mode: this.mode(),
        format: this.format(),
        readOnly: this.readOnly(),
        theme: this.theme(),
      };
      const variables = this.variables();
      untracked(() => this.push(now, variables));
    });
  }

  /** The live editor controller; `undefined` before it is created (after the first render) and after destroy. */
  controller(): ManifestEditorController | undefined {
    return this.editor;
  }

  private create(from?: Settable): void {
    const init = (this.createdWith = untracked(this.initOnly));
    const variables = untracked(this.variables);
    this.appliedVariables = variables?.store === 'external' ? variables.value : undefined;
    const start: Settable = from ?? (this.prev = this.settable());
    const ed = this.zone.runOutsideAngular(() =>
      createManifestEditor(this.host, {
        value: start.value,
        mode: start.mode,
        format: start.format,
        readOnly: start.readOnly,
        theme: start.theme,
        variables,
        codeEditor: init.codeEditor,
        formats: init.formats,
        recipes: init.recipes,
        guide: init.guide,
        widgets: init.widgets,
        messages: init.messages,
        onChange: (text) => {
          if (this.pushing) return;
          this.lastValue = text;
          this.zone.run(() => this.value.set(text));
        },
        onModeChange: (m) => {
          this.lastMode = m;
          this.zone.run(() => this.mode.set(m));
        },
        onFormatChange: (f) => this.zone.run(() => this.activeFormatChange.emit(f)),
        onVariablesChange: (d) => this.zone.run(() => this.variablesChange.emit(d)),
        onProblemsChange: (list) => this.zone.run(() => this.problemsChange.emit(list)),
        onHistoryChange: (state) => this.zone.run(() => this.historyChange.emit(state)),
      }),
    );
    ed.ready.catch(() => {}); // the editor already shows (and logs) a failed load
    this.editor = ed;
  }

  private recreate(): void {
    const old = this.editor!;
    // The theme has no getter: the one last pushed is what the editor shows.
    const carried: Settable = {
      value: old.getValue(),
      mode: old.getMode(),
      format: old.getFormat(),
      readOnly: old.getReadOnly(),
      theme: this.prev!.theme,
    };
    const hadHistory = old.canUndo() || old.canRedo();
    this.zone.runOutsideAngular(() => old.destroy());
    this.create(carried);
    // The core reports history changes only from the empty history a new editor starts with, so it never says
    // that the outgoing editor's undo steps are gone. Say it here, with the core's frozen payload.
    if (hadHistory) this.historyChange.emit(Object.freeze({ canUndo: false, canRedo: false }));
  }

  private push(now: Settable, variables: VariablesOption | undefined): void {
    const ed = this.editor;
    if (!ed) return;
    const before = this.prev!;
    this.prev = now;
    const patch: Patch = {};
    if (now.value !== this.lastValue && now.value !== ed.getValue()) patch.value = now.value;
    this.lastValue = now.value;
    if (now.mode !== this.lastMode && now.mode !== ed.getMode()) patch.mode = now.mode;
    this.lastMode = now.mode;
    if (now.format !== before.format) patch.format = now.format;
    if (now.readOnly !== before.readOnly) patch.readOnly = now.readOnly;
    if (now.theme !== before.theme) patch.theme = now.theme;
    // `update({ variables })` re-applies an equal list: compare by reference. A changed store kind is not pushed:
    // the recreation reads it.
    if (
      variables?.store === 'external' &&
      this.createdWith?.store === 'external' &&
      variables.value !== this.appliedVariables
    ) {
      this.appliedVariables = variables.value;
      patch.variables = variables.value;
    }
    if (Object.keys(patch).length === 0) return;
    this.pushing = true;
    try {
      this.zone.runOutsideAngular(() => ed.update(patch));
    } finally {
      this.pushing = false;
    }
  }

  private settable(): Settable {
    return untracked(() => ({
      value: this.value(),
      mode: this.mode(),
      format: this.format(),
      readOnly: this.readOnly(),
      theme: this.theme(),
    }));
  }
}
