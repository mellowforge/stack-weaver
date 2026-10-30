// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toData } from '../../src/document/data.js';
import { parseText } from '../../src/document/parse.js';
import { kindCatalog } from '../../src/engine/catalog.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import { skeletonFor } from '../../src/visual/skeleton.js';
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

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const SVC = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n';

async function mount(options: ManifestEditorOptions = {}) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: DEPLOY, ...options });
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0));
  return made;
}
const trigger = () => el.querySelector<HTMLButtonElement>('.sw-add-resource')!;
const dialog = () => document.querySelector<HTMLElement>('[role=dialog]');
const search = () => dialog()!.querySelector<HTMLInputElement>('input[type=search]')!;
const typeSearch = (q: string) => {
  search().value = q;
  search().dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const open = async () => {
  trigger().click();
  await Promise.resolve();
};

describe('Add resource picker', () => {
  it('"+ Add resource" opens a modal dialog with focus on the search box', async () => {
    await mount();
    expect(trigger().textContent).toBe('+ Add resource');
    expect(dialog()).toBeNull();
    await open();
    const d = dialog()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Add resource');
    expect(document.activeElement).toBe(search());
    expect(search().getAttribute('aria-label')).toBeTruthy();
  });

  it('intent groups list curated kinds in order', async () => {
    await mount();
    await open();
    const catalog = kindCatalog(kubernetesFormat);
    const groups = [...dialog()!.querySelectorAll<HTMLElement>('.sw-picker-group')];
    expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual(catalog.curated.map((g) => g.label));
    expect([...groups[0]!.querySelectorAll('.sw-picker-card')].map((c) => c.getAttribute('data-sw-kind'))).toEqual(
      catalog.curated[0]!.kinds.map((k) => `${k.apiVersion}/${k.kind}`),
    );
  });

  it('search filters all kinds by kind name and description', async () => {
    await mount();
    await open();
    typeSearch('statefulset');
    const kinds = () => [...dialog()!.querySelectorAll('.sw-picker-card')].map((c) => c.getAttribute('data-sw-kind'));
    expect(kinds()).toContain('apps/v1/StatefulSet');
    expect(kinds()[0]).toBe('apps/v1/StatefulSet'); // name matches come before description matches

    const entry = kindCatalog(kubernetesFormat).curated[0]!.kinds[0]!;
    const word = entry.description.split(/\W+/).filter((w) => w.length > 5 && !entry.kind.toLowerCase().includes(w.toLowerCase())).sort((a, b) => b.length - a.length)[0]!;
    typeSearch(word);
    expect(kinds()).toContain(`${entry.apiVersion}/${entry.kind}`);

    typeSearch('zzzz-no-such-kind');
    expect(kinds()).toEqual([]);
    expect(dialog()!.querySelector('.sw-picker-empty')).not.toBeNull();
  });

  it('Escape closes and returns focus to the trigger', async () => {
    await mount();
    await open();
    key(dialog()!, { key: 'Escape' });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('Tab is trapped', async () => {
    await mount();
    await open();
    const d = dialog()!;
    const focusable = [...d.querySelectorAll<HTMLElement>('button, input')].filter((e) => !e.hasAttribute('disabled'));
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    last.focus();
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    d.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    d.dispatchEvent(back);
    expect(document.activeElement).toBe(last);
  });

  it('choosing Deployment appends a document from skeletonFor and selects it', async () => {
    const { ctx, editor } = await mount({ value: SVC });
    const select = vi.spyOn(ctx, 'select');
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="apps/v1/Deployment"]')!.click();
    await vi.waitFor(() => expect(editor.getValue()).toContain('kind: Deployment'));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    const docs = parseText(editor.getValue()).docs;
    expect(docs).toHaveLength(2);
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const entry = kubernetesFormat.kinds().find((k) => k.kind === 'Deployment')!;
    expect(editor.getValue()).toBe(`${SVC}---\n${skeletonFor(entry, bundle, ctx.guide(), '\n')}`);
    expect(select).toHaveBeenCalledWith({ doc: 1, path: [] });
  });

  it('works on an empty document', async () => {
    const { editor } = await mount({ value: '', format: 'kubernetes' });
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="v1/Service"]')!.click();
    await vi.waitFor(() => expect(editor.getValue()).toContain('kind: Service'));
    expect(parseText(editor.getValue()).ok).toBe(true);
  });

  it('the skeleton validates with zero errors except placeholders', async () => {
    const entry = kubernetesFormat.kinds().find((k) => k.apiVersion === 'apps/v1' && k.kind === 'Deployment')!;
    const bundle = (await loadKubernetesKind('apps/v1', 'Deployment'))!;
    const yaml = skeletonFor(entry, bundle, kubernetesFormat.guide, '\n');
    const parsed = parseText(yaml);
    expect(parsed.ok).toBe(true);
    const value = toData(parsed, 0) as Record<string, unknown>;
    expect(value['apiVersion']).toBe('apps/v1');
    expect(value['kind']).toBe('Deployment');
    expect((value['metadata'] as Record<string, unknown>)['name']).toBe('deployment');
    const required = ((bundle.schema as any).$defs[entry.defName].required ?? []) as string[];
    const placeholders = required.map((p) => `/${p}`);
    const errors = bundle.validate(value).filter((e) => !placeholders.some((p) => e.instancePath === p || e.instancePath.startsWith(`${p}/`)));
    expect(errors).toEqual([]);
  });

  it('skeletonFor honours the line ending', async () => {
    const entry = kubernetesFormat.kinds().find((k) => k.kind === 'Service' && k.apiVersion === 'v1')!;
    const bundle = (await loadKubernetesKind('v1', 'Service'))!;
    const yaml = skeletonFor(entry, bundle, kubernetesFormat.guide, '\r\n');
    expect(yaml).toContain('\r\n');
    expect(yaml.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('compose has no Add resource button', async () => {
    await mount({ format: 'compose', value: 'services:\n  web:\n    image: nginx\n' });
    expect(el.querySelector('.sw-add-resource')?.hasAttribute('hidden') ?? true).toBe(true);
  });
});

describe('removing a section', () => {
  const removeBtn = () => el.querySelector<HTMLButtonElement>('.sw-section-remove')!;
  const confirmGroup = () => el.querySelector<HTMLElement>('.sw-section-confirm');

  it('remove section on a document uses deleteDocument after confirm', async () => {
    const { ctx, editor } = await mount({ value: `${SVC}---\n${DEPLOY}` });
    const edit = vi.spyOn(ctx.store, 'edit');
    ctx.select({ doc: 1, path: [] });
    await new Promise((r) => setTimeout(r, 0));
    removeBtn().click();
    expect(confirmGroup()!.hidden).toBe(false);
    expect(edit).not.toHaveBeenCalled();
    confirmGroup()!.querySelector<HTMLButtonElement>('.sw-confirm-yes')!.click();
    expect(edit).toHaveBeenCalledWith({ op: 'deleteDocument', doc: 1 });
    expect(parseText(editor.getValue()).docs.filter((d) => d.contents !== null)).toHaveLength(1);
    expect(editor.getValue()).not.toContain('Deployment');
  });

  it('Cancel keeps the section', async () => {
    const { ctx, editor } = await mount({ value: `${SVC}---\n${DEPLOY}` });
    ctx.select({ doc: 1, path: [] });
    removeBtn().click();
    confirmGroup()!.querySelector<HTMLButtonElement>('.sw-confirm-no')!.click();
    expect(confirmGroup()!.hidden).toBe(true);
    expect(document.activeElement).toBe(removeBtn());
    expect(editor.getValue()).toContain('Deployment');
  });

  it('removes an inner section with a delete edit', async () => {
    const { ctx, editor } = await mount();
    ctx.select({ doc: 0, path: ['spec'] });
    removeBtn().click();
    confirmGroup()!.querySelector<HTMLButtonElement>('.sw-confirm-yes')!.click();
    expect(editor.getValue()).not.toContain('replicas');
  });
});
