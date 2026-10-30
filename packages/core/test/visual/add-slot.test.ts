// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeNode } from '../../src/document/describe.js';
import { toData } from '../../src/document/data.js';
import type { NodeRef } from '../../src/document/types.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { renderAddSlot } from '../../src/visual/add-slot.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  labels:\n    app: web\nspec:\n  replicas: 2\n';
const POD = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - name: a\n      image: nginx\n';

type Made = Awaited<ReturnType<typeof mount>>;

async function mount(options: ManifestEditorOptions = {}) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: DEPLOY, ...options });
  await made.editor.ready;
  await made.ctx.loadBundle(0);
  return made;
}

/** A slot over the node at `path`, attached to the page. */
function slotFor(ctx: Made['ctx'], path: (string | number)[]): HTMLElement {
  const ref: NodeRef = { doc: 0, path };
  const slot = renderAddSlot(ctx, ref);
  document.body.append(slot);
  return slot;
}
const names = (slot: HTMLElement) => [...slot.querySelectorAll<HTMLElement>('[data-sw-add]')].map((b) => b.dataset['swAdd']);
const data = (ctx: Made['ctx']) => toData(ctx.store.parsed, 0) as Record<string, any>;

describe('add-here slot', () => {
  it('slot lists missing fields by tier, required first', async () => {
    const { ctx } = await mount({ value: 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - image: nginx\n' });
    const slot = slotFor(ctx, ['spec', 'containers', 0]);
    expect(slot.classList.contains('sw-add-slot')).toBe(true);
    expect(names(slot)[0]).toBe('name'); // the container's required field comes first
    const required = slot.querySelector('[data-sw-tier="required"]')!;
    expect(required.querySelector('[data-sw-add="name"]')).not.toBeNull();
    expect(slot.querySelector('[data-sw-tier="recommended"], [data-sw-tier="common"]')).not.toBeNull();
  });

  it('advanced fields are behind a disclosure', async () => {
    const { ctx } = await mount();
    const slot = slotFor(ctx, ['spec']);
    const toggle = slot.querySelector<HTMLButtonElement>('.sw-add-advanced-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = slot.querySelector<HTMLElement>(`[id="${toggle.getAttribute('aria-controls')}"]`)!;
    expect(panel.hidden).toBe(true);
    expect(panel.querySelectorAll('[data-sw-add]').length).toBeGreaterThan(0);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('adding a field selects or focuses it via EditResult.at', async () => {
    const { ctx } = await mount();
    const select = vi.spyOn(ctx, 'select');
    const slot = slotFor(ctx, ['spec']);
    const first = slot.querySelector<HTMLElement>('[data-sw-add]')!;
    const key = first.dataset['swAdd']!;
    first.click();
    expect(data(ctx)['spec']).toHaveProperty(key);
    expect(select).toHaveBeenCalledWith({ doc: 0, path: ['spec', key] });
  });

  it('labels, annotations and compose services get "Add key"', async () => {
    const { ctx } = await mount();
    const labels = slotFor(ctx, ['metadata', 'labels']);
    const input = labels.querySelector<HTMLInputElement>('.sw-add-key-input')!;
    expect(input.getAttribute('aria-label')).toBeTruthy();
    input.value = 'tier';
    labels.querySelector<HTMLButtonElement>('.sw-add-key-btn')!.click();
    expect(data(ctx)['metadata'].labels).toEqual({ app: 'web', tier: '' });
    expect(input.value).toBe('');

    ctx.store.edit({ op: 'add', at: { doc: 0, path: ['metadata'] }, key: 'annotations', value: {} });
    expect(slotFor(ctx, ['metadata', 'annotations']).querySelector('.sw-add-key-input')).not.toBeNull();

    const compose = await mount({ format: 'compose', value: 'services:\n  web:\n    image: nginx\n' });
    const services = slotFor(compose.ctx, ['services']);
    services.querySelector<HTMLInputElement>('.sw-add-key-input')!.value = 'db';
    services.querySelector<HTMLButtonElement>('.sw-add-key-btn')!.click();
    expect(Object.keys((toData(compose.ctx.store.parsed, 0) as any).services)).toEqual(['web', 'db']);
  });

  it('duplicate key shows the duplicate-key message', async () => {
    const { ctx } = await mount();
    const slot = slotFor(ctx, ['metadata', 'labels']);
    slot.querySelector<HTMLInputElement>('.sw-add-key-input')!.value = 'app';
    slot.querySelector<HTMLButtonElement>('.sw-add-key-btn')!.click();
    expect(slot.querySelector('.sw-add-error')!.textContent).toBe(ctx.messages.ui.keyExists);
  });

  it('Add item on a sequence pushes a template', async () => {
    const { ctx } = await mount({ value: POD });
    const slot = slotFor(ctx, ['spec', 'containers']);
    slot.querySelector<HTMLButtonElement>('.sw-add-seq')!.click();
    expect(data(ctx)['spec'].containers).toHaveLength(2);
  });

  it('refused add (flow) shows "edit in code" link', async () => {
    const { ctx } = await mount();
    vi.spyOn(ctx.store, 'edit').mockReturnValue({ ok: false, reason: 'flow' });
    const reveal = vi.spyOn(ctx, 'editInCode');
    const slot = slotFor(ctx, ['spec']);
    const first = slot.querySelector<HTMLElement>('[data-sw-add]')!;
    first.click();
    const link = slot.querySelector<HTMLButtonElement>('.sw-add-error .sw-link')!;
    expect(link.textContent).toBe(ctx.messages.ui.editInCode);
    link.click();
    expect(reveal).toHaveBeenCalledTimes(1);
    const view = describeNode(ctx.store.parsed, { doc: 0, path: ['spec'] })!;
    expect(reveal).toHaveBeenCalledWith(view.keyRange ?? view.range);
  });

  it('is disabled where the node cannot be edited visually', async () => {
    const { ctx } = await mount({ value: 'apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: web}\n' });
    const slot = slotFor(ctx, ['metadata']);
    expect([...slot.querySelectorAll<HTMLButtonElement>('[data-sw-add]')].every((b) => b.disabled)).toBe(true);
  });

  it('is shown at the end of the visual pane section', async () => {
    await mount();
    expect(el.querySelector('.sw-section .sw-add-slot')).not.toBeNull();
  });

  it('compose root slot offers networks/volumes/configs/secrets', async () => {
    const { ctx } = await mount({ format: 'compose', value: 'services:\n  web:\n    image: nginx\n' });
    const all = names(slotFor(ctx, []));
    for (const k of ['networks', 'volumes', 'configs', 'secrets']) expect(all).toContain(k);
  });
});
