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
