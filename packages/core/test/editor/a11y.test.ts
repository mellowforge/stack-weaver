// @vitest-environment happy-dom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { EditorMode, ManifestEditorOptions } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const css = readFileSync(join(process.cwd(), 'src/styles/stack-weaver.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

const DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: three
  template:
    spec:
      containers:
        - name: app
          image: nginx
---
apiVersion: v1
kind: Service
metadata:
  name: web
`;

async function mount(options: ManifestEditorOptions = {}) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', value: DEPLOY, ...options });
  await made.editor.ready;
  return made;
}

async function mountWithRows(options: ManifestEditorOptions = {}) {
  const made = await mount(options);
  await vi.waitFor(() => expect(el.querySelector('.sw-row input, .sw-row select')).not.toBeNull());
  return made;
}

// ---- accessible names ------------------------------------------------------------------------

/** Roles that need no author-supplied name: structure, live regions and presentation. Every other role must be named. */
const EXEMPT_ROLES = new Set(['list', 'listitem', 'status', 'alert', 'presentation', 'none']);

function textOf(ids: string, root: Document): string {
  return ids
    .split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
}

/** A simplified accessible name: aria-labelledby, aria-label, a label, then (for roles that allow it) content. */
function accessibleName(node: Element): string {
  const doc = node.ownerDocument;
  const by = node.getAttribute('aria-labelledby');
  if (by) return textOf(by, doc);
  const label = node.getAttribute('aria-label');
  if (label && label.trim() !== '') return label.trim();
  if (node.id) {
    const l = [...doc.querySelectorAll('label')].find((x) => x.getAttribute('for') === node.id);
    if (l?.textContent?.trim()) return l.textContent.trim();
  }
  const wrapping = node.closest('label');
  if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
  if (node.matches('button, a[href], [role=radio], [role=button], [role=option], [role=link], [role=menuitem], [role=tab]')) return (node.textContent ?? '').trim();
  return '';
}

function unnamed(root: HTMLElement): string[] {
  const out: string[] = [];
  for (const node of root.querySelectorAll('button, input, select, textarea, [role]')) {
    if (node.closest('[hidden]')) continue;
    if (node.matches('input[type=hidden]')) continue;
    if (node.matches('.sw-outline-group')) continue; // an APG tree's group of children needs no name of its own
    const role = node.getAttribute('role');
    if (role !== null && EXEMPT_ROLES.has(role) && !node.matches('button, input, select, textarea')) continue;
    if (accessibleName(node) === '') out.push(`${node.tagName.toLowerCase()}.${node.className}[role=${role ?? ''}]`);
  }
  return out;
}

describe('accessible names', () => {
  for (const mode of ['visual', 'split', 'code'] as EditorMode[]) {
    it(`every interactive element has an accessible name (${mode})`, async () => {
      const { editor } = await (mode === 'code' ? mount({ mode }) : mountWithRows({ mode }));
      expect(unnamed(el)).toEqual([]);
      editor.destroy();
    });
  }

  it('every interactive element has an accessible name with the picker open and problems present', async () => {
    const { editor } = await mountWithRows({ mode: 'visual' });
    await vi.waitFor(() => expect(el.querySelector('.sw-problem')).not.toBeNull());
    el.querySelector<HTMLButtonElement>('.sw-add-resource')!.click();
    expect(el.ownerDocument.querySelector('.sw-picker')).not.toBeNull();
    expect(unnamed(el.ownerDocument.body)).toEqual([]);
    editor.destroy();
  });

  it('every interactive element has an accessible name in an empty editor with recipes and with broken yaml', async () => {
    const { editor } = await mount({ value: '' });
    expect(el.querySelector('.sw-recipe')).not.toBeNull();
    expect(unnamed(el)).toEqual([]);
    editor.setValue('a: [\n');
    expect(unnamed(el)).toEqual([]);
    editor.destroy();
  });

  it('a tree item is named by its own label, not by its nested group', async () => {
    const { editor } = await mount({ mode: 'visual' });
    const items = [...el.querySelectorAll<HTMLElement>('[role=treeitem]')];
    expect(items.length).toBeGreaterThan(2);
    for (const item of items) {
      const labelledby = item.getAttribute('aria-labelledby');
      expect(labelledby).toBeTruthy();
      const label = el.ownerDocument.getElementById(labelledby!)!;
      expect(label.parentElement).toBe(item);
      expect(label.classList.contains('sw-outline-label')).toBe(true);
    }
    const ids = items.map((i) => i.getAttribute('aria-labelledby'));
    expect(new Set(ids).size).toBe(ids.length);
    editor.destroy();
  });

  it('the section path is an ordered list whose separators are hidden from assistive technology', async () => {
    const { editor } = await mount({ mode: 'visual' });
    const nav = el.querySelector<HTMLElement>('nav.sw-section-crumbs')!;
    expect(nav.getAttribute('aria-label')).toBe(defaultUiMessages.sectionPathLabel);
    expect(defaultUiMessages.sectionPathLabel).not.toBe(defaultUiMessages.breadcrumbLabel);
    const list = nav.querySelector(':scope > ol')!;
    expect(list).not.toBeNull();
    const lis = [...list.querySelectorAll(':scope > li')];
    expect(lis.length).toBeGreaterThan(0);
    for (const li of lis) expect(li.textContent!.replace('›', '').trim()).not.toBe('');
    for (const sep of nav.querySelectorAll('.sw-crumb-sep')) expect(sep.getAttribute('aria-hidden')).toBe('true');
    expect(lis[lis.length - 1]!.querySelector('[aria-current=location]')).not.toBeNull();
    editor.destroy();
  });

  it('the two navigation landmarks have different names', async () => {
    const { editor } = await mount({ mode: 'split' });
    const names = [...el.querySelectorAll('nav')].map((n) => n.getAttribute('aria-label'));
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(new Set(names).size).toBe(names.length);
    editor.destroy();
  });
});

// ---- live regions ----------------------------------------------------------------------------

describe('live regions', () => {
  it('problem count is announced politely, banner assertively', async () => {
    const { editor } = await mount({ mode: 'visual' });
    expect(el.querySelector('.sw-problem-count')!.getAttribute('aria-live')).toBe('polite');
    const banner = el.querySelector('.sw-banner')!;
    expect(banner.getAttribute('aria-live')).toBe('assertive');
    expect(banner.getAttribute('role')).toBe('alert');
    editor.destroy();
  });
});

// ---- removal focus ---------------------------------------------------------------------------

describe('focus after removal', () => {
  it('removing the last section leaves focus on a visible element, not on body', async () => {
    const { editor } = await mount({ mode: 'visual', value: 'apiVersion: v1\nkind: Service\nmetadata:\n  name: web\n' });
    el.querySelector<HTMLButtonElement>('.sw-section-remove')!.click();
    el.querySelector<HTMLButtonElement>('.sw-confirm-yes')!.click();
    expect(editor.getValue().trim()).toBe('');
    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(el.contains(active)).toBe(true);
    expect(active.closest('[hidden]')).toBeNull();
    editor.destroy();
  });
});

// ---- messages --------------------------------------------------------------------------------

describe('messages', () => {
  it('messages.ui overrides replace visible strings', async () => {
    const { editor } = await mount({
      mode: 'visual',
      messages: { ui: { addResource: 'Neue Ressource', outlineLabel: 'Gliederung', sectionPathLabel: 'Abschnittspfad' } },
    });
    expect(el.querySelector('.sw-add-resource')!.textContent).toBe('Neue Ressource');
    expect(el.querySelector('[role=tree]')!.getAttribute('aria-label')).toBe('Gliederung');
    expect(el.querySelector('nav.sw-section-crumbs')!.getAttribute('aria-label')).toBe('Abschnittspfad');
    expect(el.textContent).not.toContain('+ Add resource');
    editor.destroy();
  });
});

// ---- CSS -------------------------------------------------------------------------------------

function block(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} block`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}
function tokens(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--sw-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const light = tokens(block('.sw-editor'));
const dark = tokens(block(".sw-editor[data-sw-theme='dark']"));

describe('theming', () => {
  it('breadcrumb items are spaced with CSS, so separators never touch the next label', () => {
    expect(block('.sw-crumb-list')).toMatch(/gap:/);
    expect(block('.sw-crumb-sep')).toMatch(/margin-inline-start:/);
  });

  it('dark theme defines every token', () => {
    const colours = [...light].filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)).map(([k]) => k);
    expect(colours.length).toBeGreaterThan(8);
    expect(colours.filter((k) => !dark.has(k))).toEqual([]);
  });

  it('every --sw-* variable the stylesheet reads is defined', () => {
    const used = new Set([...css.matchAll(/var\((--sw-[\w-]+)/g)].map((m) => m[1]!));
    expect([...used].filter((k) => !light.has(k))).toEqual([]);
  });
});

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('contrast', () => {
  const pairs: [string, string, number?][] = [
    ['--sw-fg', '--sw-bg'],
    ['--sw-on-accent', '--sw-accent'],
    ['--sw-accent', '--sw-bg'],
    ['--sw-error', '--sw-bg'],
    ['--sw-muted', '--sw-bg'],
    ['--sw-warning', '--sw-bg'],
    ['--sw-info', '--sw-bg'],
    ['--sw-focus', '--sw-bg', 3],
    ['--sw-control-border', '--sw-bg', 3],
  ];
  for (const [name, theme] of [['light', light], ['dark', dark]] as const) {
    for (const [fg, bg, min = 4.5] of pairs) {
      it(`${fg} on ${bg} is at least ${min}:1 (${name})`, () => {
        const merged = new Map([...light, ...theme]);
        const f = merged.get(fg);
        const b = merged.get(bg);
        expect(f, fg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(b, bg).toMatch(/^#[0-9a-f]{6}$/i);
        expect(contrast(f!, b!)).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('the selected outline item and the checked mode radio use --sw-on-accent, not a hard-coded colour', () => {
    expect(block(".sw-outline-item[aria-selected='true'] > .sw-outline-label")).toContain('var(--sw-on-accent)');
    expect(block(".sw-mode-radio[aria-checked='true']")).toContain('var(--sw-on-accent)');
    expect(css).not.toMatch(/color:\s*#fff/i);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sourceFiles(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []));
}

describe('focus-visible', () => {
  it('focus-visible styles exist for every interactive class', async () => {
    const { editor } = await mountWithRows({ mode: 'split' });
    await vi.waitFor(() => expect(el.querySelector('.sw-problem')).not.toBeNull());
    el.querySelector<HTMLButtonElement>('.sw-section-remove')!.click(); // reveals the confirm buttons
    el.querySelector<HTMLButtonElement>('.sw-add-resource')!.click(); // the picker
    // Each interactive element needs a `:focus-visible` rule for at least one of its `sw-*` classes.
    const elements: { name: string; classes: string[] }[] = [];
    const sel = 'button, input, select, textarea, a[href], [tabindex], [role=treeitem], [role=radio], [role=dialog]';
    for (const node of el.ownerDocument.body.querySelectorAll(sel)) {
      if (node.closest('.sw-pane-code')) continue; // the code editor brings its own focus style
      const classes = [...node.classList].filter((c) => c.startsWith('sw-'));
      elements.push({ name: classes.join('.'), classes });
    }
    // The recipe cards only exist while the document is empty.
    elements.push({ name: 'sw-recipe', classes: ['sw-recipe'] }, { name: 'sw-recipes-blank', classes: ['sw-recipes-blank'] });
    // Every `sw-*` class given to a button, input, select or textarea anywhere in src/ (covers widgets not rendered here).
    for (const file of sourceFiles(join(process.cwd(), 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/'(?:button|input|select|textarea)',\s*\{[^}]*?class:\s*'([^']+)'/g)) {
        const classes = m[1]!.split(/\s+/).filter((c) => c.startsWith('sw-'));
        elements.push({ name: `${classes.join('.')} (${file.split('/').pop()})`, classes });
      }
    }
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! })).filter((r) => r.selector.includes(':focus-visible'));
    const ruleFor = (c: string) => rules.find((r) => r.selector.split(',').some((part) => new RegExp(`\\.${c}:focus-visible(?![\\w-])`).test(part)));
    const covered = (c: string): boolean => ruleFor(c) !== undefined;
    const missing = [...new Set(elements.filter((e) => !e.classes.some(covered)).map((e) => e.name))];
    // And the rule must really draw something.
    const invisible = rules.filter((r) => !/outline:\s*(?!none)[^;]+;|box-shadow:\s*(?!none)[^;]+;/.test(r.body)).map((r) => r.selector);
    expect(invisible).toEqual([]);
    expect(missing).toEqual([]);
    editor.destroy();
  });
});
