import { createManifestEditor } from '@stack-weaver/core';
import type { ChangeOrigin, CodeEditorAdapter, ManifestEditorController } from '@stack-weaver/core';
import { EXAMPLES, readTheme, statusLine } from '@stack-weaver/demo-kit';
import type { DemoExample, SiteTheme } from '@stack-weaver/demo-kit';
import { createToolbar } from './toolbar.js';
import { watchTheme } from './theme-switch.js';

export interface VanillaDemoOptions {
  /** The code editor; the default is the real CodeMirror adapter. Tests pass a textarea. */
  readonly codeEditor?: CodeEditorAdapter;
}

export interface VanillaDemo {
  /** The live editor, or `undefined` while it is being recreated. */
  controller(): ManifestEditorController | undefined;
  destroy(): void;
}

/** The variables store kind of an example; a different kind needs a new editor (the kind is fixed at creation). */
const storeKind = (ex: DemoExample): string => ex.variables?.store ?? 'x-variables';

/**
 * The Vanilla JS demo: a toolbar, the editor in split mode and a status line. The React and Angular demos in the
 * iframes have the same parts and labels.
 */
export function mountVanillaDemo(root: HTMLElement, options: VanillaDemoOptions = {}): VanillaDemo {
  const abort = new AbortController();
  let example: DemoExample = EXAMPLES[0]!;
  let readOnly = false;
  let theme: SiteTheme = readTheme();
  let editor: ManifestEditorController | undefined;
  let problems = 0;
  let activeFormat: string | undefined;
  let origin: ChangeOrigin | undefined;
  /** Set around the demo's own `update()`: that change is the example, not something the user did. */
  let pushing = false;

  const wrap = document.createElement('div');
  wrap.className = 'demo-area';
  const toolbar = createToolbar(
    {
      onExample: (id) => choose(EXAMPLES.find((e) => e.id === id)!),
      onReadOnly: (value) => {
        readOnly = value;
        editor?.setReadOnly(value);
      },
      onUndo: () => editor?.undo(),
      onRedo: () => editor?.redo(),
    },
    abort.signal,
  );
  const host = document.createElement('div');
  host.className = 'demo-editor';
  const status = document.createElement('p');
  status.className = 'demo-status';
  status.setAttribute('role', 'status');
  wrap.append(toolbar.el, host, status);
  root.append(wrap);

  const render = (): void => {
    status.textContent = statusLine({ problems, activeFormat, origin });
  };

  function create(ex: DemoExample): void {
    problems = 0;
    activeFormat = undefined;
    origin = undefined;
    toolbar.setHistory({ canUndo: false, canRedo: false });
    const ed = createManifestEditor(host, {
      format: ex.format,
      value: ex.value,
      variables: ex.variables,
      mode: 'split',
      readOnly,
      theme,
      codeEditor: options.codeEditor,
      onChange: (_value, meta) => {
        if (pushing) return;
        origin = meta.origin;
        render();
      },
      onProblemsChange: (list) => {
        problems = list.length;
        render();
      },
      onFormatChange: (format) => {
        activeFormat = format;
        render();
      },
      onHistoryChange: (state) => toolbar.setHistory(state),
    });
    ed.ready.catch(() => {}); // the editor already shows (and logs) a failed load
    editor = ed;
    render();
  }

  function choose(next: DemoExample): void {
    const previous = example;
    example = next;
    if (!editor || storeKind(previous) !== storeKind(next)) {
      editor?.destroy();
      host.replaceChildren();
      create(next);
      return;
    }
    origin = undefined;
    pushing = true;
    try {
      editor.update({
        format: next.format,
        value: next.value,
        variables: next.variables?.store === 'external' ? next.variables.value : undefined,
      });
    } finally {
      pushing = false;
    }
    render();
  }

  watchTheme((next) => {
    theme = next;
    editor?.setTheme(next);
  }, abort.signal);

  create(example);

  let destroyed = false;
  return {
    controller: () => editor,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      editor?.destroy();
      editor = undefined;
      wrap.remove();
    },
  };
}
