// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { mountSection } from '../../src/visual/section.js';
import type { SectionSlots } from '../../src/visual/section.js';
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

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  namespace: prod\nspec:\n  replicas: 2\n';
const CRD = 'apiVersion: example.io/v1\nkind: Widget\nmetadata:\n  name: w\n';

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'split', ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0)); // bundle loads started by the pane settle
  return { ...made, fake: adapter.last! };
}

const items = () => [...el.querySelectorAll<HTMLElement>('[role=treeitem]')];
const item = (label: string) => items().find((i) => i.querySelector('.sw-outline-label')!.textContent === label)!;
const click = (label: string) => item(label).querySelector<HTMLElement>('.sw-outline-label')!.click();
const rows = () => [...el.querySelectorAll<HTMLElement>('.sw-section .sw-row')];
const rowText = (key: string) => {
  const r = el.querySelector(`.sw-section .sw-row[data-sw-key="${key}"]`);
  return r?.querySelector('.sw-row-value')?.textContent ?? r?.querySelector<HTMLInputElement>('input')?.value;
};
const title = () => el.querySelector('.sw-section-title')?.textContent;

describe('visual pane', () => {
  it('section shows heading, path breadcrumb and scalar rows as inputs', async () => {
    await mount({ value: DEPLOY });
    expect(item('Deployment web')).toBeTruthy();
    click('metadata');
    expect(title()).toBe('metadata');
    const crumb = el.querySelector('.sw-section-crumbs')!;
    expect(crumb.textContent).toContain('Deployment web');
    expect(crumb.textContent).toContain('metadata');
    expect(rows().map((r) => r.dataset['swKey'])).toEqual(['name', 'namespace']);
    expect(rowText('name')).toBe('web');
    expect(rowText('namespace')).toBe('prod');
    expect(el.querySelectorAll('.sw-section input.sw-input').length).toBe(2);
  });

  it('visual re-renders 100 ms after a code change', async () => {
    const { fake } = await mount({ value: DEPLOY });
    click('spec');
    expect(rowText('replicas')).toBe('2');
    vi.useFakeTimers();
    fake.type(DEPLOY.replace('replicas: 2', 'replicas: 3'));
    await vi.advanceTimersByTimeAsync(99);
    expect(rowText('replicas')).toBe('2');
    fake.type(DEPLOY.replace('replicas: 2', 'replicas: 4')); // restarts the 100 ms
    await vi.advanceTimersByTimeAsync(99);
    expect(rowText('replicas')).toBe('2');
    await vi.advanceTimersByTimeAsync(1);
    expect(rowText('replicas')).toBe('4');
  });

  it('visual re-renders immediately after a visual or history change', async () => {
    const { ctx } = await mount({ value: DEPLOY });
    click('spec');
    ctx.store.edit({ op: 'set', at: { doc: 0, path: ['spec', 'replicas'] }, value: 5 }, { group: 'g' });
    expect(rowText('replicas')).toBe('5');
    ctx.store.undo();
    expect(rowText('replicas')).toBe('2');
  });

  it('pending re-render flushes on pointerdown or focusin inside the visual pane', async () => {
    const { fake } = await mount({ value: DEPLOY });
    click('spec');
    vi.useFakeTimers();
    fake.type(DEPLOY.replace('replicas: 2', 'replicas: 3'));
    expect(rowText('replicas')).toBe('2');
    el.querySelector('.sw-section')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(rowText('replicas')).toBe('3');
    fake.type(DEPLOY.replace('replicas: 2', 'replicas: 6'));
    expect(rowText('replicas')).toBe('3');
    item('spec').dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(rowText('replicas')).toBe('6');
  });

  it('selection survives re-render by node id, and falls back to the nearest ancestor', async () => {
    const { ctx } = await mount({ value: DEPLOY });
    click('spec');
    ctx.store.setText(DEPLOY.replace('replicas: 2', 'replicas: 9'), 'api');
    expect(item('spec').getAttribute('aria-selected')).toBe('true');
    expect(title()).toBe('spec');
    click('metadata');
    ctx.store.setText(DEPLOY.replace(/metadata:\n {2}name: web\n {2}namespace: prod\n/, ''), 'api');
    expect(item('Deployment')).toBeTruthy();
    expect(item('Deployment').getAttribute('aria-selected')).toBe('true');
  });

  it('reuses rows across updates', async () => {
    const { ctx } = await mount({ value: DEPLOY });
    click('spec');
    const before = rows()[0];
    ctx.store.setText(DEPLOY.replace('replicas: 2', 'replicas: 7'), 'api');
    expect(rows()[0]).toBe(before);
    expect(rowText('replicas')).toBe('7');
  });

  it('visual is read-only while parse is broken', async () => {
    const { ctx, fake } = await mount({ value: DEPLOY });
    click('spec');
    const edit = vi.spyOn(ctx.store, 'edit');
    fake.type(DEPLOY + 'bad: [\n');
    el.querySelector('.sw-section')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const banner = el.querySelector<HTMLElement>('.sw-banner')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('last valid version');
    expect(rowText('replicas')).toBe('2'); // lastGood
    expect(el.querySelector('.sw-pane-visual')!.hasAttribute('data-sw-readonly')).toBe(true);
    // Every editing control is disabled; the cards that only navigate stay usable.
    const enabled = [...el.querySelectorAll<HTMLElement>('.sw-section input, .sw-section select, .sw-section textarea, .sw-section button')].filter(
      (c) => !(c as HTMLButtonElement).disabled && !c.classList.contains('sw-row-card'),
    );
    expect(enabled).toEqual([]);
    expect(banner.querySelector('button')!.disabled).toBe(false); // the way out stays usable
    banner.querySelector<HTMLElement>('button')!.click();
    const first = ctx.store.parsed.errors[0]!;
    expect(fake.revealed?.range.from).toBe(first.from);
    expect(edit).not.toHaveBeenCalled();
    // fixing the text clears the banner
    fake.type(DEPLOY);
    el.querySelector('.sw-section')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(banner.hidden).toBe(true);
  });

  it('unknown kind does not block later documents', async () => {
    await mount({ value: `${CRD}---\n${DEPLOY}` });
    expect(items().filter((i) => i.getAttribute('aria-level') === '1').map((i) => i.querySelector('.sw-outline-label')!.textContent)).toEqual([
      'Widget w',
      'Deployment web',
    ]);
    click('Widget w');
    const card = el.querySelector('.sw-unknown-kind')!;
    expect(card.textContent).toContain('Unknown kind, edit in code');
    expect(item('Widget w').hasAttribute('aria-expanded')).toBe(false);
    click('Deployment web');
    expect(el.querySelector('.sw-unknown-kind')).toBeNull();
    click('spec');
    expect(rowText('replicas')).toBe('2');
  });

  it('unknown-kind card link reveals the document range', async () => {
    const { fake } = await mount({ value: `${CRD}---\n${DEPLOY}` });
    click('Widget w');
    el.querySelector<HTMLElement>('.sw-unknown-kind button')!.click();
    expect(fake.revealed?.range).toEqual({ from: 0, to: CRD.length });
  });

  it('read-only node shows "edit in code" link that reveals its range', async () => {
    const text = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: c\ndata: { a: b }\n';
    const { fake } = await mount({ value: text });
    click('data');
    const link = el.querySelector<HTMLButtonElement>('.sw-section-note button')!;
    expect(link.textContent).toBe('Edit in code');
    link.click();
    expect(text.slice(fake.revealed!.range.from, fake.revealed!.range.to)).toContain('data');
  });

  it('reveal(ref) selects the outline node', async () => {
    const { editor } = await mount({ value: DEPLOY });
    editor.reveal({ doc: 0, path: ['spec', 'replicas'] });
    expect(item('spec').getAttribute('aria-selected')).toBe('true');
    expect(rowText('replicas')).toBe('2');
  });

  it('a problem click in visual mode selects the node instead of the hidden code pane', async () => {
    const { editor, fake } = await mount({ value: DEPLOY.replace('replicas: 2', 'replicas: x'), mode: 'visual' });
    await vi.waitFor(() => expect(editor.getProblems().length).toBeGreaterThan(0));
    const problem = editor.getProblems().find((p) => p.path.join('/') === 'spec/replicas')!;
    expect(problem).toBeTruthy();
    el.querySelector<HTMLElement>('.sw-problem')!.click();
    expect(item('spec').getAttribute('aria-selected')).toBe('true');
    expect(fake.revealed).toBeUndefined();
  });

  it('shows an empty state without nodes', async () => {
    await mount({ value: '' });
    expect(el.querySelector('.sw-visual-empty')?.textContent).toContain('Nothing to show');
  });

  it('row labels refresh once the schema has loaded', async () => {
    const guide = { kubernetes: { fields: { 'io.k8s.api.apps.v1.DeploymentSpec#replicas': { label: 'How many copies' } } } };
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: FormatDefinition = { ...kubernetesFormat, loadSchema: async (p, d) => (await gate, kubernetesFormat.loadSchema(p, d)) };
    createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'split', value: DEPLOY, guide, formats: [slow] });
    await vi.waitFor(() => expect(items().length).toBeGreaterThan(0)); // ready itself waits for the schema
    click('spec'); // the row exists before the schema does
    const label = () => el.querySelector('.sw-section .sw-row[data-sw-key="replicas"] .sw-row-label')?.textContent;
    expect(label()).toBe('replicas');
    release();
    await vi.waitFor(() => expect(label()).toBe('How many copies'));
  });

  it('problems that arrive while the pane is hidden show when it is shown again', async () => {
    const { editor, ctx } = await mount({ value: DEPLOY, mode: 'visual' });
    click('spec');
    vi.useFakeTimers();
    ctx.store.setText(DEPLOY.replace('replicas: 2', 'replicas: x'), 'api'); // rendered now; validation is 150 ms away
    editor.setMode('code'); // hides the visual pane before the problems arrive
    await vi.advanceTimersByTimeAsync(400);
    expect(editor.getProblems().some((p) => p.path.join('/') === 'spec/replicas')).toBe(true);
    editor.setMode('visual');
    const list = el.querySelector('.sw-section .sw-row[data-sw-key="replicas"] .sw-row-problems');
    expect(list).not.toBeNull();
    expect(list!.textContent).not.toBe('');
  });

  it('a pending render then pointerdown then click on an outline item still selects it', async () => {
    const { fake } = await mount({ value: DEPLOY });
    click('spec');
    vi.useFakeTimers();
    fake.type(`${DEPLOY}status:\n  a: {}\n`); // changes the outline, so the flush must patch it
    const target = item('metadata').querySelector<HTMLElement>('.sw-outline-label')!;
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(items().some((i) => i.dataset['swId'] === '0:status')).toBe(true);
    expect(target.isConnected).toBe(true);
    target.click();
    expect(item('metadata').getAttribute('aria-selected')).toBe('true');
    expect(title()).toBe('metadata');
  });

  it('does not render while hidden, and renders when shown', async () => {
    const { editor } = await mount({ value: DEPLOY, mode: 'code' });
    expect(items().length).toBe(0);
    editor.setMode('visual');
    expect(items().length).toBeGreaterThan(0);
    expect(title()).toBe('Deployment web');
  });
});

describe('mountSection read-only contract', () => {
  it('passes readOnly=true and no problems to a field row while the text is broken, and refreshes its label', async () => {
    const guide = { kubernetes: { fields: { 'io.k8s.api.apps.v1.DeploymentSpec#replicas': { label: 'Copies' } } } };
    const { ctx, fake } = await mount({ value: DEPLOY, guide });
    const calls: unknown[][] = [];
    const labels: string[] = [];
    const slots: SectionSlots = {
      field: () => ({
        el: document.createElement('div'),
        setLabel: (l) => labels.push(l),
        update: (...args) => calls.push(args),
        destroy() {},
      }),
      addSlot: () => undefined,
    };
    const section = mountSection(ctx, { doc: 0, path: ['spec'] }, slots, document);
    expect(calls.at(-1)).toEqual([2, false, []]);
    expect(labels.at(-1)).toBe('Copies');
    fake.type(`${DEPLOY}bad: [\n`);
    section.update();
    expect(ctx.store.parsed.ok).toBe(false);
    expect(calls.at(-1)).toEqual([2, true, []]);
    section.destroy();
  });
});
