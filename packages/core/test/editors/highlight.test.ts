// @vitest-environment happy-dom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { codemirrorAdapter } from '../../src/editors/codemirror/index.js';
import { swHighlightStyle } from '../../src/editors/codemirror/highlight.js';

const dir = join(process.cwd(), 'src/editors/codemirror');
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);

it('syntax colours come from the --sw tokens, so they follow the dark theme', () => {
  // Found in the browser: the default highlight style drew keys as #00f on the dark background.
  const colours = swHighlightStyle.specs.map((s) => s.color).filter((c) => c !== undefined);
  expect(colours.length).toBeGreaterThan(0);
  for (const c of colours) expect(c).toMatch(/^var\(--sw-(accent|info|warning|muted)\)$/);
});

it("the adapter installs that style, not CodeMirror's light-only default", () => {
  const el = document.createElement('div');
  document.body.append(el);
  const inst = codemirrorAdapter().mount(el, {
    text: 'apiVersion: v1\n',
    readOnly: false,
    theme: 'dark',
    ariaLabel: 'YAML',
    onChange: () => {},
    onUndo: () => {},
    onRedo: () => {},
  });
  const injected = [...document.querySelectorAll('style')].map((s) => s.textContent ?? '').join('\n');
  expect(injected).toContain('var(--sw-accent)');
  expect(injected).not.toMatch(/color:\s*#00f/i);
  inst.destroy();
  el.remove();
});

it('no file of the adapter uses defaultHighlightStyle, and the index uses swHighlightStyle', () => {
  for (const [name, text] of sources) expect(text, name).not.toMatch(/import\s*\{[^}]*defaultHighlightStyle/);
  expect(sources.find(([f]) => f === 'index.ts')![1]).toContain('syntaxHighlighting(swHighlightStyle)');
});

it('every --sw token the adapter reads is defined by the stylesheet or documented as optional', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/stack-weaver.css'), 'utf8');
  const optional = new Set(['--sw-selection', '--sw-active-line']);
  const used = new Set(sources.flatMap(([, text]) => [...text.matchAll(/var\((--sw-[a-z-]+)/g)].map((m) => m[1]!)));
  expect(used.size).toBeGreaterThan(0);
  expect([...used].filter((t) => !optional.has(t) && !css.includes(`${t}:`))).toEqual([]);
});
