import type { CodeEditorAdapter } from '@stack-weaver/core';
import type { SiteConfig } from '@stack-weaver/demo-kit';
import { copyButton } from './footer.js';
import { SNIPPETS, SNIPPET_LANG, highlightInto } from './snippets.js';
import type { Framework } from './snippets.js';
import { mountVanillaDemo } from './vanilla-demo.js';

const TABS: readonly { id: Framework; label: string }[] = [
  { id: 'vanilla', label: 'Vanilla JS' },
  { id: 'react', label: 'React' },
  { id: 'angular', label: 'Angular' },
];

export interface FrameworksOptions {
  /** Replaces the CodeMirror adapter in the Vanilla demo (tests). */
  readonly codeEditor?: CodeEditorAdapter;
}

let instance = 0;

function codeBlock(framework: Framework): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'code';
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  highlightInto(code, SNIPPETS[framework], SNIPPET_LANG[framework]);
  pre.append(code);
  const name = TABS.find((t) => t.id === framework)!.label;
  pre.tabIndex = 0; // keyboard-scrollable
  pre.setAttribute('role', 'region'); // a named region, so the focusable <pre> is announced
  pre.setAttribute('aria-label', `${name} example code`);
  wrap.append(pre, copyButton(() => SNIPPETS[framework], { name: `${name} example`, select: code }));
  return wrap;
}

function iframeDemo(framework: 'react' | 'angular', site: SiteConfig): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'demo-area demo-area--frame';
  const frame = document.createElement('iframe');
  frame.title = `${framework === 'angular' ? 'Angular' : 'React'} demo`;
  frame.setAttribute('loading', 'lazy');
  frame.src = `${site.base}${framework}/`;
  frame.className = 'demo-frame';
  wrap.append(frame);
  return wrap;
}

/** Builds the Vanilla / React / Angular tab bar: a live demo and a snippet per panel. */
export function mountFrameworks(root: HTMLElement, site: SiteConfig, options: FrameworksOptions = {}): { destroy(): void } {
  const abort = new AbortController();
  const uid = `fw${++instance}`;

  const head = document.createElement('div');
  head.className = 'section-head';
  const h2 = document.createElement('h2');
  h2.textContent = 'One editor, three frameworks';
  const sub = document.createElement('p');
  sub.textContent = 'The same editor and the same controls in every binding. Pick one and try it.';
  head.append(h2, sub);

  const list = document.createElement('div');
  list.className = 'tabs';
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Framework');

  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];
  const opened = new Set<Framework>();

  const panelsWrap = document.createElement('div');
  panelsWrap.className = 'tab-panels';

  TABS.forEach((t, i) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `${uid}-tab-${t.id}`;
    tab.className = 'tab';
    tab.textContent = t.label;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${uid}-panel-${t.id}`);
    tab.addEventListener('click', () => activate(i), { signal: abort.signal });
    tabs.push(tab);

    const panel = document.createElement('div');
    panel.id = `${uid}-panel-${t.id}`;
    panel.className = 'tab-panel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panels.push(panel);
    panelsWrap.append(panel);
  });
  list.append(...tabs);
  root.append(head, list, panelsWrap);

  // The Vanilla panel is first and visible from the start, so its editor can measure itself right away.
  const vanilla = mountVanillaDemo(panels[0]!, { codeEditor: options.codeEditor });
  opened.add('vanilla');
  TABS.forEach((t, i) => panels[i]!.append(codeBlock(t.id)));

  function activate(index: number, focus = false): void {
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i]!.hidden = i !== index;
    });
    const id = TABS[index]!.id;
    if (!opened.has(id) && id !== 'vanilla') {
      opened.add(id);
      panels[index]!.prepend(iframeDemo(id, site));
    }
    if (focus) tabs[index]!.focus();
  }

  list.addEventListener(
    'keydown',
    (e) => {
      const from = tabs.indexOf(e.target as HTMLButtonElement);
      if (from < 0) return;
      const n = tabs.length;
      let to: number;
      switch (e.key) {
        case 'ArrowRight':
          to = (from + 1) % n;
          break;
        case 'ArrowLeft':
          to = (from + n - 1) % n;
          break;
        case 'Home':
          to = 0;
          break;
        case 'End':
          to = n - 1;
          break;
        default:
          return;
      }
      e.preventDefault();
      activate(to, true);
    },
    { signal: abort.signal },
  );

  activate(0);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      vanilla.destroy();
    },
  };
}
