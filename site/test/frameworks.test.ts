import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { siteConfig, textareaAdapter } from '@stack-weaver/demo-kit';
import { mountFrameworks } from '../src/frameworks.js';
import { SNIPPETS, highlightInto, tokenize } from '../src/snippets.js';

let errors: MockInstance<typeof console.error>;
let root: HTMLElement;
let mounted: Array<{ destroy(): void }> = [];

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  mounted.forEach((m) => m.destroy());
  mounted = [];
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

function mount(site = siteConfig({})) {
  const frameworks = mountFrameworks(root, site, { codeEditor: textareaAdapter() });
  mounted.push(frameworks);
  return frameworks;
}

const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const key = (el: HTMLElement, k: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
const tab = (label: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.trim() === label)!;
const panelOf = (t: HTMLElement) => document.getElementById(t.getAttribute('aria-controls')!)!;
const iframes = () => [...root.querySelectorAll('iframe')];

describe('framework tabs', () => {
  it('is an APG tablist: aria-selected, aria-controls and a roving tabindex', () => {
    mount();
    expect(root.querySelector('[role="tablist"]')).not.toBeNull();
    expect([...root.querySelectorAll('[role="tab"]')].map((t) => t.textContent?.trim())).toEqual(['Vanilla JS', 'React', 'Angular']);
    for (const t of root.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const panel = panelOf(t);
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(t.id);
    }
    expect(tab('Vanilla JS').getAttribute('aria-selected')).toBe('true');
    expect(tab('Vanilla JS').tabIndex).toBe(0);
    expect(tab('React').getAttribute('aria-selected')).toBe('false');
    expect(tab('React').tabIndex).toBe(-1);
    expect(panelOf(tab('Vanilla JS')).hidden).toBe(false);
    expect(panelOf(tab('React')).hidden).toBe(true);

    click(tab('React'));
    expect(tab('React').getAttribute('aria-selected')).toBe('true');
    expect(tab('React').tabIndex).toBe(0);
    expect(tab('Vanilla JS').tabIndex).toBe(-1);
    expect(panelOf(tab('React')).hidden).toBe(false);
    expect(panelOf(tab('Vanilla JS')).hidden).toBe(true);
  });

  it('moves with Arrow, Home and End keys and wraps', () => {
    mount();
    key(tab('Vanilla JS'), 'ArrowRight');
    expect(tab('React').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('React'));
    key(tab('React'), 'ArrowRight');
    expect(tab('Angular').getAttribute('aria-selected')).toBe('true');
    key(tab('Angular'), 'ArrowRight');
    expect(tab('Vanilla JS').getAttribute('aria-selected')).toBe('true');
    key(tab('Vanilla JS'), 'ArrowLeft');
    expect(tab('Angular').getAttribute('aria-selected')).toBe('true');
    key(tab('Angular'), 'Home');
    expect(tab('Vanilla JS').getAttribute('aria-selected')).toBe('true');
    key(tab('Vanilla JS'), 'End');
    expect(tab('Angular').getAttribute('aria-selected')).toBe('true');
  });

  it('mounts the Vanilla editor in the page and creates an iframe only on first activation', () => {
    mount();
    expect(panelOf(tab('Vanilla JS')).querySelector('.sw-editor')).not.toBeNull();
    expect(iframes()).toHaveLength(0);

    click(tab('React'));
    expect(iframes()).toHaveLength(1);
    const frame = iframes()[0]!;
    expect(frame.getAttribute('src')).toBe('/react/');
    expect(frame.title).toBe('React demo');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.className).toBe('demo-frame');
    expect(panelOf(tab('React')).contains(frame)).toBe(true);

    click(tab('Vanilla JS'));
    click(tab('React'));
    expect(iframes()).toHaveLength(1);
    expect(iframes()[0]).toBe(frame);
  });

  it('the Angular iframe is created only on first activation', () => {
    mount();
    click(tab('React'));
    expect(iframes()).toHaveLength(1);

    click(tab('Angular'));
    expect(iframes()).toHaveLength(2);
    const frame = iframes()[1]!;
    expect(frame.getAttribute('src')).toBe('/angular/');
    expect(frame.title).toBe('Angular demo');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.className).toBe('demo-frame');
    expect(panelOf(tab('Angular')).contains(frame)).toBe(true);

    click(tab('React'));
    click(tab('Angular'));
    expect(iframes()).toHaveLength(2);
    expect(iframes()[1]).toBe(frame);
  });

  it('puts the base in the iframe URL', () => {
    mount(siteConfig({ GITHUB_REPOSITORY: 'Constantine-24/stack-weaver' }));
    click(tab('React'));
    click(tab('Angular'));
    expect(iframes().map((f) => [f.getAttribute('src'), f.title])).toEqual([
      ['/stack-weaver/react/', 'React demo'],
      ['/stack-weaver/angular/', 'Angular demo'],
    ]);
  });

  it('gives every panel a highlighted snippet with a copy button', () => {
    mount();
    for (const label of ['Vanilla JS', 'React', 'Angular']) {
      const panel = panelOf(tab(label));
      expect(panel.querySelector('pre code')!.textContent).toBe(SNIPPETS[{ 'Vanilla JS': 'vanilla', React: 'react', Angular: 'angular' }[label] as 'vanilla']);
      expect(panel.querySelector('button.copy')!.getAttribute('aria-label')).toBe(`Copy ${label} example`);
    }
  });

  it('stops listening after destroy', () => {
    const frameworks = mount();
    frameworks.destroy();
    click(tab('React'));
    expect(iframes()).toHaveLength(0);
  });
});

describe('snippet highlighting', () => {
  it('builds DOM nodes, so snippet text is never parsed as HTML', () => {
    const target = document.createElement('code');
    highlightInto(target, `<img src=x onerror="alert(1)"> // <b>`, 'html');
    expect(target.textContent).toBe(`<img src=x onerror="alert(1)"> // <b>`);
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('b')).toBeNull();
  });

  it('splits plain text from tokens', () => {
    expect(tokenize(`const a = 'x'; // done`, 'ts')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' a = ' },
      { text: `'x'`, kind: 'string' },
      { text: '; ' },
      { text: '// done', kind: 'comment' },
    ]);
  });
});
