import { useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { ComponentPropsWithoutRef, JSX, Ref } from 'react';
import { createManifestEditor } from '@stack-weaver/core';
import type {
  ChangeOrigin,
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

/**
 * Props of {@link ManifestEditor}. Other props (`className`, `style`, `aria-*`, `data-*`, ...) go to the host `div`.
 *
 * Settable props (`value`, `mode`, `format`, `readOnly`, `theme`, and `variables.value` with the `external` store)
 * are pushed to the editor when they change. Init-only props (`codeEditor`, `formats`, `recipes`, `guide`,
 * `widgets`, `messages`, and the `variables` store kind) recreate the editor when their reference changes, which
 * keeps the text, mode, format, read-only state and theme but loses the undo history: pass stable objects.
 * Callbacks may be new functions on every render.
 */
export interface ManifestEditorProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'onChange' | 'defaultValue'> {
  /**
   * The YAML text, controlled. A new `value` is pushed only when it differs from the previous render's and from the
   * editor's text, so a parent that does not update it from `onChange` never reverts the user's typing.
   */
  value?: string;
  /** The initial text when `value` is not given; read once. */
  defaultValue?: string;
  /**
   * Called with the full text after every change: typing (`'code'`), the form (`'visual'`), undo and redo
   * (`'history'`) and controller calls such as `ref.current.setValue` (`'api'`). Not called for a `value` prop push.
   */
  onChange?: (value: string, meta: { readonly origin: ChangeOrigin }) => void;
  /** The mode, pushed when it changes (as `value` is). Default `'split'`. */
  mode?: EditorMode;
  /** Called when the mode changes: the mode switch, `ref.current.setMode`, and controls that open Split. */
  onModeChange?: (mode: EditorMode) => void;
  /** The format option: `'auto'` (the default) or a format id. The editor never changes it; see `onFormatChange`. */
  format?: ManifestEditorOptions['format'];
  /** Called with the resolved format id (`undefined` for none) when it changes, including once at mount. */
  onFormatChange?: (activeFormat: string | undefined) => void;
  /** Blocks user edits. Default `false`. */
  readOnly?: boolean;
  /** Colour scheme; `'auto'` (the default) follows `prefers-color-scheme`. */
  theme?: EditorTheme;
  /**
   * Where variable declarations live. The store kind is init-only; with the `external` store, a new `value` array is
   * pushed (compared by reference).
   */
  variables?: VariablesOption;
  /** Called with the declarations when an edit changes them; not for a pushed `variables.value`. */
  onVariablesChange?: (decls: readonly VariableDecl[]) => void;
  /** Called with the problems when they change. */
  onProblemsChange?: (problems: readonly Problem[]) => void;
  /** Called when `canUndo` or `canRedo` changes. */
  onHistoryChange?: (state: { readonly canUndo: boolean; readonly canRedo: boolean }) => void;
  /** The code editor. Default: the CodeMirror adapter, loaded on demand. Init-only. */
  codeEditor?: CodeEditorAdapter;
  /** Extra formats. Init-only. */
  formats?: readonly FormatDefinition[];
  /** Extra starter recipes. Init-only. */
  recipes?: readonly Recipe[];
  /** Guide overrides, keyed by format id. Init-only. */
  guide?: ManifestEditorOptions['guide'];
  /** Input widgets by name. Init-only. */
  widgets?: WidgetRegistry;
  /** UI and schema message overrides. Init-only. */
  messages?: EditorMessages;
  /** Receives the live controller, or `null` when unmounted. A recreated editor is a new controller. */
  ref?: Ref<ManifestEditorController | null>;
}

/** The settable props as last rendered, with the core defaults filled in where `undefined` means the default. */
interface Settable {
  readonly value: string | undefined;
  readonly mode: EditorMode | undefined;
  readonly format: string;
  readonly readOnly: boolean;
  readonly theme: EditorTheme;
}

/** What a recreated editor starts from: the outgoing editor's state. */
interface Carried {
  readonly value: string;
  readonly mode: EditorMode;
  readonly format: string;
  readonly readOnly: boolean;
  readonly theme: EditorTheme;
}

type Patch = { -readonly [K in keyof ManifestEditorUpdate]: ManifestEditorUpdate[K] };

function settable(p: ManifestEditorProps): Settable {
  return { value: p.value, mode: p.mode, format: p.format ?? 'auto', readOnly: p.readOnly ?? false, theme: p.theme ?? 'auto' };
}

/**
 * The `@stack-weaver/core` manifest editor as a React component. It renders an empty `div` and the core builds the
 * editor inside it after the commit, so it is safe for server rendering and under `<StrictMode>`.
 */
export function ManifestEditor(props: ManifestEditorProps): JSX.Element {
  // Every editor prop is taken out, so `rest` holds only the host div's own props; the effects read them from `props`.
  const {
    value,
    defaultValue,
    onChange,
    mode,
    onModeChange,
    format,
    onFormatChange,
    readOnly,
    theme,
    variables,
    onVariablesChange,
    onProblemsChange,
    onHistoryChange,
    codeEditor,
    formats,
    recipes,
    guide,
    widgets,
    messages,
    ref,
    ...rest
  } = props;

  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<ManifestEditorController | null>(null);
  /** The newest committed props: callbacks read them, so a new callback never recreates the editor. */
  const latest = useRef(props);
  /** The settable props of the previous render: only a prop that changed since is pushed. */
  const prev = useRef<Settable>(settable(props));
  /** The `external` declarations last handed to the editor. */
  const appliedVariables = useRef<readonly VariableDecl[] | undefined>(undefined);
  /** Set while the wrapper's own `update()` runs: its `onChange` is an echo of a prop. */
  const pushing = useRef(false);
  /** The outgoing editor's state, from its destroy to the next create. */
  const carry = useRef<Carried | undefined>(undefined);

  // Declared first, so the effects below see this render's props.
  useLayoutEffect(() => {
    latest.current = props;
  });

  const variablesStore = variables?.store;
  const initDeps = [codeEditor, formats, recipes, guide, widgets, messages, variablesStore];

  useLayoutEffect(() => {
    const p = latest.current;
    const from = carry.current;
    carry.current = undefined;
    const vars = p.variables;
    appliedVariables.current = vars?.store === 'external' ? vars.value : undefined;
    const ed = createManifestEditor(host.current!, {
      value: from ? from.value : (p.value ?? p.defaultValue ?? ''),
      mode: from ? from.mode : p.mode,
      format: from ? from.format : p.format,
      readOnly: from ? from.readOnly : p.readOnly,
      theme: from ? from.theme : p.theme,
      variables: vars,
      codeEditor: p.codeEditor,
      formats: p.formats,
      recipes: p.recipes,
      guide: p.guide,
      widgets: p.widgets,
      messages: p.messages,
      onChange: (text, meta) => {
        if (!pushing.current) latest.current.onChange?.(text, meta);
      },
      onModeChange: (m) => latest.current.onModeChange?.(m),
      onFormatChange: (f) => latest.current.onFormatChange?.(f),
      onVariablesChange: (d) => latest.current.onVariablesChange?.(d),
      onProblemsChange: (list) => latest.current.onProblemsChange?.(list),
      onHistoryChange: (state) => latest.current.onHistoryChange?.(state),
    });
    ed.ready.catch(() => {}); // the editor already shows (and logs) a failed load
    editor.current = ed;
    return () => {
      // The theme has no getter: the one last pushed is what the editor shows.
      carry.current = {
        value: ed.getValue(),
        mode: ed.getMode(),
        format: ed.getFormat(),
        readOnly: ed.getReadOnly(),
        theme: prev.current.theme,
      };
      ed.destroy();
      editor.current = null;
    };
  }, initDeps);

  // Declared after the create effect, so it hands out the editor that effect just made.
  useImperativeHandle<ManifestEditorController | null, ManifestEditorController | null>(ref, () => editor.current, initDeps);

  // After every commit: push the settable props that changed, in one update(), without echoing onChange.
  useLayoutEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const before = prev.current;
    const now = settable(props);
    prev.current = now;
    const patch: Patch = {};
    if (now.value !== undefined && now.value !== before.value && now.value !== ed.getValue()) patch.value = now.value;
    if (now.mode !== undefined && now.mode !== before.mode && now.mode !== ed.getMode()) patch.mode = now.mode;
    if (now.format !== before.format) patch.format = now.format;
    if (now.readOnly !== before.readOnly) patch.readOnly = now.readOnly;
    if (now.theme !== before.theme) patch.theme = now.theme;
    // `update({ variables })` re-applies an equal list: compare by reference.
    if (variables?.store === 'external' && variables.value !== appliedVariables.current) {
      appliedVariables.current = variables.value;
      patch.variables = variables.value;
    }
    if (Object.keys(patch).length === 0) return;
    pushing.current = true;
    try {
      ed.update(patch);
    } finally {
      pushing.current = false;
    }
  });

  return <div {...rest} ref={host} />;
}
