import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/stack-weaver.css', import.meta.url), 'utf8');

describe('stack-weaver.css', () => {
  it('keeps the theme and stays small', () => {
    expect(css).toContain('.sw-editor');
    expect(css).toContain('--sw-bg:');
    expect(css).toContain("[data-sw-theme='dark']");
    expect(css.length).toBeLessThan(64 * 1024);
  });

  it('fills a host that has a fixed height instead of overflowing it', () => {
    // Found in the browser: a 560px host rendered a 711px editor that spilled over the next sibling.
    const layout = [...css.matchAll(/\.sw-editor \{([^}]*)\}/g)].map((m) => m[1]).join('\n');
    expect(layout).toMatch(/\n\s*height:\s*100%;/);
    expect(layout).toMatch(/min-height:\s*320px;/);
  });

  it('defines every token the CodeMirror theme reads (bar the optional selection and active-line ones)', () => {
    // Found in the browser: the theme read --sw-font-mono, which does not exist, so --sw-mono was ignored.
    const theme = readFileSync(new URL('../../src/editors/codemirror/index.ts', import.meta.url), 'utf8');
    const used = new Set([...theme.matchAll(/var\((--sw-[a-z-]+)/g)].map((m) => m[1]!));
    const optional = new Set(['--sw-selection', '--sw-active-line']);
    const missing = [...used].filter((t) => !optional.has(t) && !css.includes(`${t}:`));
    expect(missing).toEqual([]);
  });

  it('draws the border of every control with --sw-control-border, not the decorative --sw-border', () => {
    const bordersOf = (selector: string): string[] =>
      [...css.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^}]*)\}/g)]
        .filter((m) => m[2]!.split(',').some((x) => x.trim() === selector))
        .flatMap((m) => [...m[3]!.matchAll(/border:\s*[^;]*var\((--sw-[a-z-]+)\)/g)].map((b) => b[1]!));
    for (const selector of ['.sw-input', '.sw-btn', '.sw-mode-switch', '.sw-recipe', '.sw-recipes-blank', '.sw-picker-card', '.sw-add-slot']) {
      expect(bordersOf(selector), selector).toEqual(['--sw-control-border']);
    }
  });

  it('keeps the quick-fix buttons at least 24px tall (WCAG 2.5.8)', () => {
    for (const selector of ['.sw-problem-fix', '.sw-row-fix']) {
      const rule = [...css.matchAll(/(^|\n)([^{}\n][^{}]*)\{([^}]*)\}/g)].find((m) => m[2]!.split(',').some((x) => x.trim() === selector));
      expect(rule?.[3], selector).toMatch(/min-block-size:\s*24px;/);
    }
  });

  it('defines no top-level rule selector twice', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '{') {
        if (depth === 0) selectors.push(body.slice(start, i).trim().replace(/\s+/g, ' '));
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) start = i + 1;
      }
    }
    // `.sw-editor` is deliberately split in two: the tokens first, then the layout.
    const allowed = new Set(['.sw-editor']);
    expect(selectors.filter((s, i) => selectors.indexOf(s) !== i && !allowed.has(s))).toEqual([]);
  });
});
