import { describe, expect, it } from 'vitest';
import { createManifestEditor, parseText, type ChangeOrigin } from '@mellowforge/stack-weaver-core';
import {
  EXAMPLES,
  MODES,
  THEMES,
  THEME_KEY,
  applyPageTheme,
  docsLinks,
  readTheme,
  siteConfig,
  statusLine,
  textareaAdapter,
  writeTheme,
} from '../src/index.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}
const throwingStorage = (): Storage =>
  new Proxy({} as Storage, {
    get() {
      return () => {
        throw new Error('denied');
      };
    },
  });

describe('examples', () => {
  it('every example parses and validates to the expected problem count', async () => {
    for (const ex of EXAMPLES) {
      const parsed = parseText(ex.value);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createManifestEditor(host, {
        format: ex.format,
        value: ex.value,
        ...(ex.variables ? { variables: ex.variables } : {}),
        codeEditor: textareaAdapter(),
      });
      await editor.ready;
      const errors = editor.getProblems().filter((p) => p.severity === 'error');
      if (ex.id === 'broken') {
        expect(parsed.ok, ex.id).toBe(false);
        expect(host.querySelector('.sw-banner:not([hidden])'), ex.id).not.toBeNull();
      } else {
        expect(parsed.ok, ex.id).toBe(true);
        expect(errors, ex.id).toHaveLength(0);
      }
      if (ex.id === 'empty') {
        expect(editor.getProblems(), ex.id).toHaveLength(0);
        expect(host.querySelector('.sw-recipes:not([hidden])'), ex.id).not.toBeNull();
      } else {
        expect(host.querySelector('.sw-recipes:not([hidden])'), ex.id).toBeNull();
      }
      editor.destroy();
      host.remove();
    }
  });

  it('ids are unique and in order', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['kubernetes', 'compose', 'compose-external', 'empty', 'broken']);
    expect(EXAMPLES.find((e) => e.id === 'compose-external')?.variables?.store).toBe('external');
  });

  it('MODES are visual, split, code', () => {
    expect(MODES.map((m) => m.mode)).toEqual(['visual', 'split', 'code']);
    expect(THEMES.map((t) => t.theme)).toEqual(['auto', 'light', 'dark']);
  });
});

describe('theme', () => {
  it('readTheme defaults to auto, round-trips writeTheme, ignores junk and a throwing storage', () => {
    const s = memoryStorage();
    expect(readTheme(s)).toBe('auto');
    writeTheme('dark', s);
    expect(s.getItem(THEME_KEY)).toBe('dark');
    expect(readTheme(s)).toBe('dark');
    expect(readTheme(memoryStorage({ [THEME_KEY]: 'purple' }))).toBe('auto');
    expect(readTheme(throwingStorage())).toBe('auto');
    expect(() => writeTheme('light', throwingStorage())).not.toThrow();
  });

  it('applyPageTheme sets and clears data-theme', () => {
    applyPageTheme(document, 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyPageTheme(document, 'auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('status and site', () => {
  it('statusLine pluralises and names the format', () => {
    expect(statusLine({ problems: 2, activeFormat: 'kubernetes', origin: 'code' as ChangeOrigin })).toBe('2 problems · kubernetes · last change: code');
    expect(statusLine({ problems: 0, activeFormat: undefined })).toBe('No problems · no format yet');
    expect(statusLine({ problems: 1, activeFormat: 'compose' })).toBe('1 problem · compose');
  });

  it('siteConfig base and showNpm', () => {
    expect(siteConfig({})).toEqual({ name: 'stack-weaver', base: '/', repoUrl: 'https://github.com/mellowforge/stack-weaver', showNpm: false });
    expect(siteConfig({ GITHUB_REPOSITORY: 'me/sw', SHOW_NPM: '1' })).toMatchObject({ base: '/sw/', showNpm: true });
  });

  it('docsLinks point to the three READMEs', () => {
    expect(docsLinks('https://github.com/o/r')).toEqual({
      core: 'https://github.com/o/r/blob/main/packages/core/README.md',
      react: 'https://github.com/o/r/blob/main/packages/react/README.md',
      angular: 'https://github.com/o/r/blob/main/packages/angular/projects/stack-weaver-angular/README.md',
    });
  });
});

describe('textareaAdapter', () => {
  it('typing calls onChange, applyChange keeps the caret, setReadOnly blocks input, destroy removes the textarea', () => {
    const adapter = textareaAdapter();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const calls: string[] = [];
    const inst = adapter.mount(host, {
      text: 'hello world',
      readOnly: false,
      theme: 'light',
      ariaLabel: 'YAML code',
      onChange: (t) => calls.push(`change:${t}`),
      onUndo: () => calls.push('undo'),
      onRedo: () => calls.push('redo'),
    });
    const area = host.querySelector<HTMLTextAreaElement>('textarea.demo-code')!;
    expect(area.getAttribute('aria-label')).toBe('YAML code');
    expect(adapter.instances).toHaveLength(1);

    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true }));
    expect(calls).toEqual(['undo', 'redo']);

    calls.length = 0;
    adapter.instances[0]!.type('abc');
    expect(calls).toEqual(['change:abc']);
    expect(inst.getText()).toBe('abc');

    inst.applyChange({ from: 0, to: 0, insert: 'XX' });
    expect(inst.getText()).toBe('XXabc');
    expect(area.value).toBe('XXabc');
    // the caret sat at the end of the typed text (3) and moved past the insertion
    expect(inst.getSelection()).toEqual({ from: 5, to: 5 });
    expect(calls).toEqual(['change:abc']);

    inst.setDiagnostics([{ from: 0, to: 99, severity: 'error', message: 'm', code: 'yaml-syntax' as never, source: 'yaml' as never }]);
    expect(adapter.instances[0]!.diagnostics[0]!.to).toBe(5);

    calls.length = 0;
    inst.setReadOnly(true);
    expect(area.readOnly).toBe(true);
    adapter.instances[0]!.type('nope');
    expect(calls).toEqual([]);
    expect(inst.getText()).toBe('XXabc');

    inst.destroy();
    expect(host.querySelector('textarea')).toBeNull();
  });
});
