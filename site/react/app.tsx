import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ManifestEditor } from '@mellowforge/stack-weaver-react';
import type { ChangeOrigin, ManifestEditorController } from '@mellowforge/stack-weaver-react';
import type { CodeEditorAdapter } from '@mellowforge/stack-weaver-core';
import { EXAMPLES, THEMES, applyPageTheme, readTheme, statusLine } from 'stack-weaver-demo-kit';
import type { SiteTheme } from 'stack-weaver-demo-kit';
import { setSiteTheme, watchTheme } from '../src/theme-switch.js';

/** The theme radio group: the same classes and ARIA as the Vanilla `createThemeSwitch`. */
function ThemeSwitch({ theme }: { theme: SiteTheme }) {
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const index = THEMES.findIndex((t) => t.theme === theme);

  function select(to: number): void {
    setSiteTheme(THEMES[to]!.theme);
    radios.current[to]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    const n = THEMES.length;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        select((index + 1) % n);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        select((index + n - 1) % n);
        break;
      case 'Home':
        select(0);
        break;
      case 'End':
        select(n - 1);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Theme" onKeyDown={onKeyDown}>
      {THEMES.map((t, i) => (
        <button
          key={t.theme}
          ref={(node) => {
            radios.current[i] = node;
          }}
          type="button"
          role="radio"
          className="segmented__option"
          aria-checked={i === index}
          tabIndex={i === index ? 0 : -1}
          onClick={() => setSiteTheme(t.theme)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The React demo: the same toolbar, split-mode editor and status line as the Vanilla and Angular demos.
 * `codeEditor` replaces the CodeMirror adapter (tests); pass a stable value.
 */
export function App({ codeEditor }: { codeEditor?: CodeEditorAdapter }) {
  const uid = useId();
  const editor = useRef<ManifestEditorController | null>(null);
  const [example, setExample] = useState(EXAMPLES[0]!);
  const [value, setValue] = useState(example.value);
  const [readOnly, setReadOnly] = useState(false);
  const [theme, setTheme] = useState<SiteTheme>(readTheme);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [problems, setProblems] = useState(0);
  const [activeFormat, setActiveFormat] = useState<string | undefined>();
  const [origin, setOrigin] = useState<ChangeOrigin | undefined>();

  useEffect(() => {
    const abort = new AbortController();
    applyPageTheme(document, readTheme());
    watchTheme(setTheme, abort.signal);
    return () => abort.abort();
  }, []);

  function choose(id: string): void {
    const next = EXAMPLES.find((e) => e.id === id)!;
    setExample(next);
    setValue(next.value);
    setOrigin(undefined);
  }

  return (
    <div className="react-app">
      <div className="toolbar" role="group" aria-label="Demo controls">
        <label htmlFor={`${uid}-example`}>Example</label>
        <select id={`${uid}-example`} value={example.id} onChange={(e) => choose(e.target.value)}>
          {EXAMPLES.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {ex.label}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only
        </label>
        <button type="button" className="button" disabled={!history.canUndo} onClick={() => editor.current?.undo()}>
          Undo
        </button>
        <button type="button" className="button" disabled={!history.canRedo} onClick={() => editor.current?.redo()}>
          Redo
        </button>
        <ThemeSwitch theme={theme} />
      </div>
      <ManifestEditor
        className="demo-editor"
        ref={editor}
        codeEditor={codeEditor}
        value={value}
        onChange={(text, meta) => {
          setValue(text);
          setOrigin(meta.origin);
        }}
        mode="split"
        format={example.format}
        variables={example.variables}
        readOnly={readOnly}
        theme={theme}
        onProblemsChange={(list) => setProblems(list.length)}
        onFormatChange={setActiveFormat}
        onHistoryChange={setHistory}
      />
      <p className="demo-status" role="status">
        {statusLine({ problems, activeFormat, origin })}
      </p>
    </div>
  );
}
