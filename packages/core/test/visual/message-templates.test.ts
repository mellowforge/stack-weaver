// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { breadcrumbAt } from '../../src/assist/hover.js';
import { parseText } from '../../src/document/parse.js';
import { DocumentStore } from '../../src/document/store.js';
import type { YamlValue } from '../../src/document/types.js';
import { createProblemsPanel } from '../../src/editor/problems-panel.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import type { JsonSchema } from '../../src/formats/types.js';
import { createWidgetContext } from '../../src/visual/widgets/context.js';
import { defaultWidgets } from '../../src/visual/widgets/registry.js';

const host = document.createElement('div');
document.body.append(host);
afterEach(() => host.replaceChildren());

const ui = {
  ...defaultUiMessages,
  entryKeyLabel: 'K[{label}]',
  entryValueLabel: 'V[{label}]',
  namedEntryKeyLabel: 'K[{label}/{name}]',
  namedEntryValueLabel: 'V[{label}/{name}]',
  newItemLabel: 'new[{label}]',
  addItemLabel: 'additem[{label}]',
  addEntryLabel: 'addentry[{label}]',
};

function widget(name: string, text: string, path: string[], schema: JsonSchema, value: YamlValue) {
  const store = new DocumentStore(text);
  const ctx = createWidgetContext(store, { id: 'w', label: 'L', description: '', ref: { doc: 0, path }, value, schema, readOnly: false, messages: ui, guide: () => ({ groups: [], kinds: {}, fields: {} }) });
  const w = defaultWidgets[name]!.create(ctx);
  host.append(w.el);
  return w;
}
const labels = (el: Element, sel: string) => [...el.querySelectorAll(sel)].map((e) => e.getAttribute('aria-label'));

describe('message templates', () => {
  it('string-list uses newItemLabel and addItemLabel', () => {
    const w = widget('string-list', 'a:\n  - x\n', ['a'], { type: 'array', items: { type: 'string' } }, ['x']);
    expect(labels(w.el, '.sw-list-add input')).toEqual(['new[L]']);
    expect(labels(w.el, '.sw-list-add-btn')).toEqual(['additem[L]']);
  });

  it('key-value uses the entry key/value and add templates', () => {
    const w = widget('key-value', 'm:\n  a: "1"\n', ['m'], { type: 'object', additionalProperties: { type: 'string' } }, { a: '1' });
    expect(labels(w.el, '.sw-kv-key')).toEqual(['K[L/a]', 'K[L]']);
    expect(labels(w.el, '.sw-kv-value')).toEqual(['V[L/a]', 'V[L]']);
    expect(labels(w.el, '.sw-list-add-btn')).toEqual(['addentry[L]']);
  });

  it('secret-data uses namedEntryValueLabel', () => {
    const w = widget('secret-data', 'data:\n  t: dG9rZW4=\n', ['data'], { type: 'object', additionalProperties: { type: 'string', format: 'byte' } }, { t: 'dG9rZW4=' });
    expect(labels(w.el, '[data-sw-entry]')).toEqual(['V[L/t]']);
  });

  it('the problems toggle uses problemsSummary', () => {
    const panelHost = document.createElement('div');
    host.append(panelHost);
    const panel = createProblemsPanel(panelHost, {
      ui: { ...defaultUiMessages, problemsSummary: '{count} <- {label}' },
      locale: 'en',
      onSelect() {},
      onFix: () => true,
      restoreFocus() {},
    });
    panel.update([{ doc: 0, path: ['a'], from: 0, to: 1, severity: 'error', code: 'x', message: 'm', source: 'schema' } as never]);
    expect(panelHost.querySelector('.sw-problems-toggle')!.textContent).toBe('1 problem <- Problems');
  });

  it('each problem button in the panel uses problemPrefix', () => {
    const panelHost = document.createElement('div');
    host.append(panelHost);
    const panel = createProblemsPanel(panelHost, {
      ui: { ...defaultUiMessages, problemPrefix: '<{severity}> ' },
      locale: 'en',
      onSelect() {},
      onFix: () => true,
      restoreFocus() {},
    });
    panel.update([{ doc: 0, path: ['a'], from: 0, to: 1, severity: 'warning', code: 'x', message: 'm', source: 'schema' } as never]);
    expect(panelHost.querySelector('.sw-problem .sw-visually-hidden')!.textContent).toBe('<Warning> ');
  });

  it('breadcrumbAt takes a document label template', () => {
    const p = parseText('a: 1\n---\nb: 2\n');
    expect(breadcrumbAt(p, p.text.indexOf('b'))[0]).toBe('Document 2');
    expect(breadcrumbAt(p, p.text.indexOf('b'), '{n}. Dokument')[0]).toBe('2. Dokument');
  });
});
