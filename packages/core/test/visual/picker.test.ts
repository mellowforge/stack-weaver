// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toData } from '../../src/document/data.js';
import { parseText } from '../../src/document/parse.js';
import { yamlDocs } from '../../src/document/internal.js';
import { valueTemplateAt } from '../../src/engine/addable.js';
import { resolveAt } from '../../src/engine/resolve.js';
import { kindCatalog } from '../../src/engine/catalog.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { defaultUiMessages as ui } from '../../src/editor/messages.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import { loadKubernetesKind } from '../../src/formats/kubernetes/loader.js';
import { skeletonFor } from '../../src/visual/skeleton.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

let el: HTMLElement;
let editors: { destroy(): void }[];
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  editors = [];
});
afterEach(() => {
  for (const e of editors) e.destroy();
  el.remove();
  vi.restoreAllMocks();
});

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const SVC = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: s\n';

async function mount(options: ManifestEditorOptions = {}) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: DEPLOY, ...options });
  editors.push(made.editor);
  await made.editor.ready;
  await new Promise((r) => setTimeout(r, 0));
  return made;
}

/** A Kubernetes format whose schema loads wait for `release()` once `hold()` was called. */
function gatedKubernetes(): { format: FormatDefinition; hold(): void; release(): void; fail(err: unknown): void } {
  let gate: { promise: Promise<void>; resolve(): void; reject(e: unknown): void } | undefined;
  const format: FormatDefinition = {
    ...kubernetesFormat,
    async loadSchema(data) {
      if (gate) await gate.promise;
      return kubernetesFormat.loadSchema(data);
    },
  };
  return {
    format,
    hold() {
      let resolve!: () => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
      gate = { promise, resolve, reject };
    },
    release: () => gate?.resolve(),
    fail: (err) => gate?.reject(err),
  };
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

  it('Escape works when focus has left the dialog', async () => {
    await mount();
    await open();
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('the dialog is focusable and the background is inert only while it is open', async () => {
    await mount();
    const root = el.querySelector('.sw-editor')!;
    const others = () => [...root.children].filter((c) => !c.classList.contains('sw-picker-backdrop'));
    expect(others().some((c) => c.hasAttribute('inert'))).toBe(false);
    await open();
    expect(dialog()!.getAttribute('tabindex')).toBe('-1');
    expect(others().length).toBeGreaterThan(0);
    expect(others().every((c) => c.hasAttribute('inert'))).toBe(true);
    key(dialog()!, { key: 'Escape' });
    expect(others().some((c) => c.hasAttribute('inert'))).toBe(false);
  });

  it('Tab from the dialog itself enters the dialog', async () => {
    await mount();
    await open();
    dialog()!.focus();
    const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog()!.dispatchEvent(e);
    expect(dialog()!.contains(document.activeElement) && document.activeElement !== dialog()).toBe(true);
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
    const docs = yamlDocs(parseText(editor.getValue()));
    expect(docs).toHaveLength(2);
    expect(editor.getValue().startsWith(`${SVC}---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: deployment\n`)).toBe(true);
    expect(editor.getValue().endsWith('\n')).toBe(true);
    expect(select).toHaveBeenCalledWith({ doc: 1, path: [] });
  });

  it('inserts nothing when the editor became read-only while the schema loaded (A8)', async () => {
    const k8s = gatedKubernetes();
    const { editor } = await mount({ formats: [k8s.format], value: SVC });
    k8s.hold();
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="apps/v1/Deployment"]')!.click();
    editor.setReadOnly(true);
    k8s.release();
    await vi.waitFor(() => expect(dialog()!.querySelector('.sw-picker-error')!.textContent).toBe(ui.editRefused));
    expect(editor.getValue()).toBe(SVC);
  });

  it('inserts nothing and closes when the format changed while the schema loaded (A8)', async () => {
    const k8s = gatedKubernetes();
    const { editor, ctx } = await mount({ formats: [k8s.format], format: 'auto', value: SVC });
    expect(ctx.format()?.id).toBe('kubernetes');
    k8s.hold();
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="apps/v1/Deployment"]')!.click();
    editor.setValue(''); // under auto, clearing the text drops the format
    expect(ctx.format()).toBeUndefined();
    k8s.release();
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(editor.getValue()).toBe('');
  });

  it('a failed schema load shows pickerLoadFailed in the picker', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const k8s = gatedKubernetes();
    const { editor } = await mount({ formats: [k8s.format], value: SVC });
    k8s.hold();
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="apps/v1/Deployment"]')!.click();
    k8s.fail(new Error('offline'));
    await vi.waitFor(() => expect(dialog()!.querySelector('.sw-picker-error')!.textContent).toBe(ui.pickerLoadFailed));
    expect(log).toHaveBeenCalledWith('stack-weaver: adding a resource failed', expect.any(Error));
    expect(editor.getValue()).toBe(SVC);
  });

  it('a refused insert shows editRefused in the picker', async () => {
    const { ctx, editor } = await mount({ value: SVC });
    vi.spyOn(ctx.store, 'edit').mockReturnValue({ ok: false, reason: 'unsupported' });
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="apps/v1/Deployment"]')!.click();
    await vi.waitFor(() => expect(dialog()!.querySelector('.sw-picker-error')!.textContent).toBe(ui.editRefused));
    expect(editor.getValue()).toBe(SVC);
  });

  it('Mod-z in the search box does not undo the document', async () => {
    const { ctx, editor } = await mount();
    editor.setValue(SVC);
    const undo = vi.spyOn(ctx.store, 'undo');
    await open();
    key(search(), { key: 'z', ctrlKey: true, metaKey: true });
    expect(undo).not.toHaveBeenCalled();
    expect(editor.getValue()).toBe(SVC);
  });

  it('destroying the editor with the picker open releases it', async () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { editor } = await mount();
    await open();
    const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1];
    expect(handler).toBeDefined();
    const inert = [...el.querySelectorAll('[inert]')];
    expect(inert.length).toBeGreaterThan(0);
    editor.destroy();
    expect(remove).toHaveBeenCalledWith('keydown', handler, true);
    expect(inert.every((n) => !n.hasAttribute('inert'))).toBe(true);
    expect(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))).not.toThrow();
    expect(dialog()).toBeNull();
    expect(el.childNodes.length).toBe(0);
  });

  it('works on an empty document', async () => {
    const { editor } = await mount({ value: '', format: 'kubernetes' });
    await open();
    dialog()!.querySelector<HTMLElement>('[data-sw-kind="v1/Service"]')!.click();
    await vi.waitFor(() => expect(editor.getValue()).toContain('kind: Service'));
    expect(editor.getValue()).toBe('apiVersion: v1\nkind: Service\nmetadata:\n  name: service\n');
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
    const required = resolveAt(bundle, [], value)!.required.filter((p) => !['apiVersion', 'kind', 'metadata'].includes(p));
    for (const p of required) expect(value).toHaveProperty(p);
    expect(Object.keys(value).sort()).toEqual(['apiVersion', 'kind', 'metadata', ...required].sort());
    const isEmpty = (v: unknown) => v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);
    const placeholders = required.filter((p) => isEmpty(valueTemplateAt(bundle, kubernetesFormat.guide, [p], value))).map((p) => `/${p}`);
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
    expect(document.activeElement).toBe(el.querySelector('.sw-section-title'));
    expect(yamlDocs(parseText(editor.getValue())).filter((d) => d.contents !== null)).toHaveLength(1);
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
