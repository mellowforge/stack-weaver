// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toData } from '../../src/document/data.js';
import { DocumentStore } from '../../src/document/store.js';
import type { YamlPath, YamlValue } from '../../src/document/types.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { suggestKeys, suggestNames } from '../../src/visual/suggest.js';
import { createWidgetContext } from '../../src/visual/widgets/context.js';
import { defaultWidgets } from '../../src/visual/widgets/registry.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const host = document.createElement('div');
document.body.append(host);
afterEach(() => {
  host.replaceChildren();
  vi.restoreAllMocks();
});

const DOCS = `apiVersion: v1
kind: Secret
metadata:
  name: db-creds
stringData:
  username: admin
data:
  password: cGFzcw==
---
apiVersion: v1
kind: Secret
metadata:
  name: api-token
data:
  token: dG9r
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  LOG_LEVEL: info
binaryData:
  logo: AAEC
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  template:
    spec:
      containers:
        - name: web
          env:
            - name: PASSWORD
              valueFrom:
                secretKeyRef:
                  name: db-creds
                  key: pas
`;
const REF: YamlPath = ['spec', 'template', 'spec', 'containers', 0, 'env', 0, 'valueFrom', 'secretKeyRef'];

function valueAt(store: DocumentStore, doc: number, path: YamlPath): YamlValue {
  let cur: unknown = toData(store.parsed, doc);
  for (const seg of path) cur = (cur as Record<string | number, unknown> | undefined)?.[seg];
  return (cur ?? null) as YamlValue;
}

function mountWidget(name: string, param: string | undefined, text: string, doc: number, path: YamlPath) {
  const store = new DocumentStore(text);
  const ctx = createWidgetContext(store, {
    id: 'w1',
    label: 'Field',
    description: '',
    ref: { doc, path },
    value: valueAt(store, doc, path),
    schema: { type: 'string' },
    readOnly: false,
    ...(param !== undefined && { param }),
    messages: defaultUiMessages,
  });
  const w = defaultWidgets[name]!(ctx);
  host.append(w.el);
  const options = () => [...w.el.querySelectorAll('datalist option')].map((o) => (o as HTMLOptionElement).value);
  return { store, w, options, input: w.el.querySelector<HTMLInputElement>('input')!, refresh: () => w.update(valueAt(store, doc, path), false) };
}

describe('suggestNames / suggestKeys', () => {
  const p = new DocumentStore(DOCS).parsed;

  it('lists metadata.name of the matching kind in the same text', () => {
    expect(suggestNames(p, 'Secret')).toEqual(['db-creds', 'api-token']);
    expect(suggestNames(p, 'ConfigMap')).toEqual(['app-config']);
  });

  it('lists data and stringData keys, and binaryData keys for a ConfigMap only', () => {
    expect(suggestKeys(p, 'Secret', 'db-creds')).toEqual(['password', 'username']);
    expect(suggestKeys(p, 'ConfigMap', 'app-config')).toEqual(['LOG_LEVEL', 'logo']);
    expect(suggestKeys(p, 'Secret', 'api-token')).toEqual(['token']);
  });

  it('no matching docs gives an empty list, not an error', () => {
    expect(suggestNames(new DocumentStore('').parsed, 'Secret')).toEqual([]);
    expect(suggestNames(new DocumentStore('a: [').parsed, 'Secret')).toEqual([]);
    expect(suggestNames(new DocumentStore('- 1\n- 2\n').parsed, 'Secret')).toEqual([]);
    expect(suggestKeys(p, 'Secret', 'nope')).toEqual([]);
    expect(suggestKeys(p, 'Secret', 'app-config')).toEqual([]); // wrong kind
    expect(suggestNames(new DocumentStore('kind: Secret\nmetadata: 3\n').parsed, 'Secret')).toEqual([]);
  });
});

describe('reference widgets', () => {
  it('ref:Secret suggests Secret names from the same text', () => {
    const { input, options, store } = mountWidget('ref', 'Secret', DOCS, 3, [...REF, 'name']);
    expect(options()).toEqual(['db-creds', 'api-token']);
    expect(input.value).toBe('db-creds');
    expect(input.getAttribute('list')).toBe(host.querySelector('datalist')!.id);
    // Free text is still allowed.
    input.value = 'not-yet-created';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(valueAt(store, 3, [...REF, 'name'])).toBe('not-yet-created');
  });

  it('ref:ConfigMap suggests ConfigMap names', () => {
    const { options } = mountWidget('ref', 'ConfigMap', DOCS, 3, [...REF, 'name']);
    expect(options()).toEqual(['app-config']);
  });

  it('ref-key:Secret suggests keys of the named Secret', () => {
    const { options, input } = mountWidget('ref-key', 'Secret', DOCS, 3, [...REF, 'key']);
    expect(input.value).toBe('pas');
    expect(options()).toEqual(['password', 'username']);
  });

  it('ref-key follows the sibling name as it changes', () => {
    const { options, store, refresh } = mountWidget('ref-key', 'Secret', DOCS, 3, [...REF, 'key']);
    store.edit({ op: 'set', at: { doc: 3, path: [...REF, 'name'] }, value: 'api-token' });
    refresh();
    expect(options()).toEqual(['token']);
    store.edit({ op: 'set', at: { doc: 3, path: [...REF, 'name'] }, value: 'ghost' });
    refresh();
    expect(options()).toEqual([]);
  });

  it('no matching docs gives an empty list, not an error', () => {
    const only = 'spec:\n  secretKeyRef:\n    name: x\n    key: y\n';
    expect(mountWidget('ref', 'Secret', only, 0, ['spec', 'secretKeyRef', 'name']).options()).toEqual([]);
    expect(mountWidget('ref-key', 'Secret', only, 0, ['spec', 'secretKeyRef', 'key']).options()).toEqual([]);
    expect(mountWidget('ref', undefined, DOCS, 3, [...REF, 'name']).options()).toEqual([]); // no param
    expect(mountWidget('ref', 'Pod', DOCS, 3, [...REF, 'name']).options()).toEqual([]); // not a reference kind
  });

  it('the list follows the document while the widget is shown', () => {
    const { options, store, refresh } = mountWidget('ref', 'Secret', DOCS, 3, [...REF, 'name']);
    store.edit({ op: 'set', at: { doc: 1, path: ['metadata', 'name'] }, value: 'renamed' });
    refresh();
    expect(options()).toEqual(['db-creds', 'renamed']);
  });

  it('a Secret field row in the visual pane gets the picker from the guide', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: DOCS });
    await made.editor.ready;
    await made.ctx.loadBundle(3);
    made.ctx.select({ doc: 3, path: REF });
    await vi.waitFor(() => expect(el.querySelector('.sw-row[data-sw-key="name"] input')).not.toBeNull());
    const listed = (key: string) => [...el.querySelectorAll(`.sw-row[data-sw-key="${key}"] datalist option`)].map((o) => (o as HTMLOptionElement).value);
    expect(listed('name')).toEqual(['db-creds', 'api-token']);
    expect(listed('key')).toEqual(['password', 'username']);
    el.remove();
  });
});
