// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { WidgetContext, WidgetDefinition } from '../../src/visual/widgets/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n  labels:\n    app: web\nspec:\n  replicas: 2\n';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

async function mount(options: ManifestEditorOptions) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), format: 'kubernetes', mode: 'visual', value: DEPLOY, ...options });
  await made.editor.ready;
  await made.ctx.loadBundle(0);
  return made;
}

/** A host widget that records the context it was built with. */
function recording(): { def: WidgetDefinition; seen: WidgetContext[] } {
  const seen: WidgetContext[] = [];
  const def: WidgetDefinition = {
    create(ctx) {
      seen.push(ctx);
      const input = document.createElement('input');
      input.id = ctx.id;
      input.className = 'host-mine';
      input.value = JSON.stringify(ctx.value);
      return { el: input, update: (v) => void (input.value = JSON.stringify(v)), focus: () => input.focus() };
    },
  };
  return { def, seen };
}

describe('a host widget through a guide WidgetRef (B3)', () => {
  it('renders in its row with the param and the locale; its edits join one undo step', async () => {
    const { def, seen } = recording();
    const { editor, ctx } = await mount({
      widgets: { mine: def },
      guide: { kubernetes: { fields: { 'io.k8s.api.apps.v1.DeploymentSpec#replicas': { widget: { name: 'mine', param: 'P' } } } } },
      messages: { locale: 'de' },
    });
    ctx.select({ doc: 0, path: ['spec'] });
    await vi.waitFor(() => expect(el.querySelector('.sw-row[data-sw-key="replicas"] .host-mine')).not.toBeNull());
    const w = seen.at(-1)!;
    expect(w.param).toBe('P');
    expect(w.locale).toBe('de');
    expect(w.value).toBe(2);
    expect(w.ref).toEqual({ doc: 0, path: ['spec', 'replicas'] });
    // Two sets of the node merge into one undo step.
    expect(w.edit({ op: 'set', at: w.ref, value: 3 }).ok).toBe(true);
    expect(w.edit({ op: 'set', at: w.ref, value: 4 }).ok).toBe(true);
    expect(editor.getValue()).toBe(DEPLOY.replace('replicas: 2', 'replicas: 4'));
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(DEPLOY);
    expect(editor.undo()).toBe(false);
  });

  it('the locale is the validated one: an invalid tag is "en"', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { def, seen } = recording();
    const { ctx } = await mount({
      widgets: { mine: def },
      guide: { kubernetes: { fields: { 'io.k8s.api.apps.v1.DeploymentSpec#replicas': { widget: { name: 'mine' } } } } },
      messages: { locale: 'not a locale!' },
    });
    ctx.select({ doc: 0, path: ['spec'] });
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen.at(-1)!.locale).toBe('en');
    expect(seen.at(-1)!.param).toBeUndefined();
  });

  it('a host definition with managesKeys edits its mapping as a row of the parent section', async () => {
    const { def, seen } = recording();
    const { ctx } = await mount({
      widgets: { tags: { ...def, managesKeys: true } },
      guide: { kubernetes: { fields: { 'io.k8s.apimachinery.pkg.apis.meta.v1.ObjectMeta#labels': { widget: { name: 'tags' } } } } },
    });
    ctx.select({ doc: 0, path: ['metadata'] });
    await vi.waitFor(() => expect(el.querySelector('.sw-row[data-sw-key="labels"] .host-mine')).not.toBeNull());
    expect(seen.at(-1)!.value).toEqual({ app: 'web' });
    // The mapping is no outline node of its own, so it has no section (and no "Add key") either.
    const labels = [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].map((l) => l.textContent);
    expect(labels).toContain('metadata');
    expect(labels).not.toContain('labels');
    expect(el.querySelector('.sw-row[data-sw-key="labels"] .sw-row-card')).toBeNull();
  });
});
