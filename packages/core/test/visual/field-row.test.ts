// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  vi.useRealTimers();
  el.remove();
  vi.restoreAllMocks();
});

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'split', ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0));
  return { ...made, fake: adapter.last! };
}

const items = () => [...el.querySelectorAll<HTMLElement>('[role=treeitem]')];
const item = (label: string) => items().find((i) => i.querySelector('.sw-outline-label')!.textContent === label)!;
const click = (label: string) => item(label).querySelector<HTMLElement>('.sw-outline-label')!.click();
const row = (key: string) => el.querySelector<HTMLElement>(`.sw-section .sw-row[data-sw-key="${key}"]`)!;
const type = (input: HTMLInputElement, v: string) => {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const TEXT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
`;
describe('field rows', () => {
  it('row shows label, description, Required badge', async () => {
    const guide = {
      kubernetes: {
        fields: {
          'io.k8s.api.apps.v1.DeploymentSpec#replicas': { label: 'Copies', description: 'How many pods to run.' },
        },
      },
    };
    await mount({ value: TEXT, guide });
    click('spec');
    const replicas = row('replicas');
    expect(replicas.querySelector('.sw-row-label')!.textContent).toBe('Copies');
    expect(replicas.querySelector('.sw-row-description')!.textContent).toBe('How many pods to run.');
    expect(replicas.querySelector('.sw-badge')).toBeNull();
    const input = replicas.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('2');
    expect(replicas.querySelector('label')!.getAttribute('for')).toBe(input.id);
    expect(input.getAttribute('aria-describedby')).toContain(replicas.querySelector('.sw-row-description')!.id);
    // DeploymentSpec requires selector and template
    expect(row('selector').querySelector('.sw-badge')!.textContent).toBe('Required');
    // the guide's plain-language description replaces the schema's
    expect(row('selector').querySelector('.sw-row-label')!.textContent).toBe('Pod selector');
    expect(row('selector').querySelector('.sw-row-description')!.textContent).toContain('Which pods this Deployment manages');
  });

  it('typing in a row edits the document and undo restores it', async () => {
    const { ctx, editor } = await mount({ value: TEXT });
    click('spec');
    type(row('replicas').querySelector('input')!, '5');
    expect(editor.getValue()).toContain('replicas: 5');
    ctx.store.undo();
    expect(editor.getValue()).toContain('replicas: 2');
    expect(row('replicas').querySelector('input')!.value).toBe('2');
  });

  it('the inline problem prefix comes from the problemPrefix template', async () => {
    const text = TEXT.replace('replicas: 2', 'replicas: x');
    const dflt = await mount({ value: text, mode: 'visual' });
    await vi.waitFor(() => expect(dflt.editor.getProblems().some((p) => p.path.join('/') === 'spec/replicas')).toBe(true));
    click('spec');
    expect(row('replicas').querySelector('.sw-row-problems .sw-sr-only')!.textContent).toBe('Error: ');
    dflt.editor.destroy();
    const { editor } = await mount({ value: text, mode: 'visual', messages: { ui: { problemPrefix: '[{severity}] ' } } });
    await vi.waitFor(() => expect(editor.getProblems().some((p) => p.path.join('/') === 'spec/replicas')).toBe(true));
    click('spec');
    expect(row('replicas').querySelector('.sw-row-problems .sw-sr-only')!.textContent).toBe('[Error] ');
  });

  it('inline problems under the row match by path', async () => {
    const { editor } = await mount({ value: TEXT.replace('replicas: 2', 'replicas: x'), mode: 'visual' });
    await vi.waitFor(() => expect(editor.getProblems().some((p) => p.path.join('/') === 'spec/replicas')).toBe(true));
    click('spec');
    const list = row('replicas').querySelector('.sw-row-problems')!;
    expect(list.textContent).not.toBe('');
    expect(row('selector').querySelector('.sw-row-problems')?.textContent ?? '').toBe('');
    const input = row('replicas').querySelector('input')!;
    expect(input.value).toBe('x');
    expect(input.getAttribute('aria-describedby')).toContain(list.id);
  });

  it('remove button deletes the field with accessible name "Remove <label>"', async () => {
    const guide = { kubernetes: { fields: { 'io.k8s.api.apps.v1.DeploymentSpec#replicas': { label: 'Copies' } } } };
    const { editor } = await mount({ value: TEXT, guide });
    click('spec');
    const btn = row('replicas').querySelector<HTMLButtonElement>('.sw-row-remove')!;
    expect(btn.getAttribute('aria-label')).toBe('Remove Copies');
    btn.click();
    expect(editor.getValue()).not.toContain('replicas');
    expect(row('replicas')).toBeNull();
  });

  it('anchored scalar shows the "changes every alias" note', async () => {
    await mount({ value: TEXT.replace('replicas: 2', 'replicas: &r 2\n  minReadySeconds: *r') });
    click('spec');
    expect(row('replicas').querySelector('.sw-row-note')!.textContent).toContain('every alias');
    expect(row('minReadySeconds').querySelector('.sw-row-note')?.textContent ?? '').not.toContain('every alias');
    expect(row('minReadySeconds').querySelector('input')).toBeNull(); // an alias has no widget
    expect(row('minReadySeconds').querySelector<HTMLButtonElement>('.sw-row-remove')!.disabled).toBe(true);
  });

  it('nested object field renders a card that selects the child node', async () => {
    await mount({ value: TEXT });
    click('spec');
    const card = row('selector').querySelector<HTMLButtonElement>('.sw-row-card')!;
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('selector');
    card.click();
    expect(item('Pod selector').getAttribute('aria-selected')).toBe('true');
    // sequences list their items by name, else "Item n"
    click('Containers');
    expect(row('0').querySelector('.sw-row-label')!.textContent).toBe('web');
  });

  it('sequence items without a name are labelled "Item n"', async () => {
    await mount({ value: TEXT.replace('- name: web\n          image: nginx', '- image: nginx') });
    click('Containers');
    expect(row('0').querySelector('.sw-row-label')!.textContent).toBe('Item 1');
  });

  it('a field the schema does not know renders read-only with "edit in code"', async () => {
    const { fake, editor } = await mount({ value: TEXT.replace('replicas: 2', 'replicas: 2\n  foo: 1') });
    click('spec');
    const foo = row('foo');
    expect(foo.querySelector('input, select')).toBeNull();
    expect(foo.querySelector('.sw-row-value')!.textContent).toBe('1');
    const link = foo.querySelector<HTMLButtonElement>('.sw-link')!;
    expect(link.textContent).toBe('Edit in code');
    link.click();
    const { from, to } = fake.revealed!.range;
    expect(editor.getValue().slice(from, to)).toBe('1');
  });

  it('while the bundle is loading, rows render read-only text and become widgets when it resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: FormatDefinition = { ...kubernetesFormat, loadSchema: async (data) => (await gate, kubernetesFormat.loadSchema(data)) };
    createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', value: TEXT, formats: [slow] });
    await vi.waitFor(() => expect(items().length).toBeGreaterThan(0)); // ready itself waits for the schema
    click('spec');
    expect(row('replicas').querySelector('input')).toBeNull();
    expect(row('replicas').querySelector('.sw-row-value')!.textContent).toBe('2');
    expect(row('selector').querySelector('.sw-row-card')).toBeTruthy(); // nested parts stay reachable
    release();
    await vi.waitFor(() => expect(row('replicas').querySelector('input')).not.toBeNull());
    expect(row('replicas').querySelector<HTMLInputElement>('input')!.value).toBe('2');
  });

  it('widgets are disabled while read-only', async () => {
    const { editor } = await mount({ value: TEXT });
    click('spec');
    editor.setReadOnly(true);
    expect(row('replicas').querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
    expect(row('replicas').querySelector<HTMLButtonElement>('.sw-row-remove')!.disabled).toBe(true);
  });

  it('a host widget replaces a built-in one by name', async () => {
    const widgets = {
      integer: {
        create: (ctx: { id: string; value: unknown }) => {
          const b = document.createElement('button');
          b.id = ctx.id;
          b.className = 'my-widget';
          b.textContent = String(ctx.value);
          return { el: b, update() {}, focus() {} };
        },
      },
    };
    await mount({ value: TEXT, widgets: widgets as never });
    click('spec');
    expect(row('replicas').querySelector('.my-widget')!.textContent).toBe('2');
  });
});
