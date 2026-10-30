// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseText } from '../../src/document/parse.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { badgeText, loadBuiltinFormats, mergeFormats, resolveFormat } from '../../src/editor/formats.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const COMPOSE = 'services:\n  web:\n    image: nginx\n';
const K8S = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => el.remove());

async function mount(options: ManifestEditorOptions) {
  const made = createEditorWithContext(el, { codeEditor: createFakeAdapter(), ...options });
  await made.editor.ready;
  return made;
}

const fake = (over: Partial<FormatDefinition> = {}): FormatDefinition => ({
  id: 'fake',
  label: 'Fake',
  version: '9',
  rootModel: 'mapping',
  detect: () => false,
  kinds: () => [],
  loadSchema: async () => undefined,
  guide: {
    groups: [{ id: 'g', label: 'G', order: 1 }],
    kinds: {},
    fields: { 'D#a': { label: 'Base' } },
  },
  ...over,
});

describe('format resolution', () => {
  it('auto detects compose from text', async () => {
    const { ctx } = await mount({ value: COMPOSE });
    expect(ctx.format()?.id).toBe('compose');
  });

  it('auto detects kubernetes from text', async () => {
    const { ctx } = await mount({ value: K8S });
    expect(ctx.format()?.id).toBe('kubernetes');
  });

  it('auto with empty text has no format until a recipe is chosen', async () => {
    const { ctx, editor } = await mount({});
    expect(ctx.format()).toBeUndefined();
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe('No format');
    editor.setValue(COMPOSE); // what choosing a recipe does: writes text
    expect(ctx.format()?.id).toBe('compose');
  });

  it('auto drops the format when the text is cleared, and keeps it through broken text', async () => {
    const { ctx, editor } = await mount({ value: K8S });
    expect(el.querySelector('.sw-format-badge')!.textContent).toContain('Kubernetes');
    editor.setValue(K8S + 'bad: [unclosed\n');
    expect(ctx.format()?.id).toBe('kubernetes');
    editor.setValue('');
    expect(ctx.format()).toBeUndefined();
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe('No format');
    editor.setValue(COMPOSE);
    expect(ctx.format()?.id).toBe('compose');
  });

  it('an explicit format stays when the text is cleared', async () => {
    const { ctx, editor } = await mount({ format: 'kubernetes', value: K8S });
    editor.setValue('');
    expect(ctx.format()?.id).toBe('kubernetes');
  });

  it('explicit format wins', async () => {
    const { ctx } = await mount({ format: 'kubernetes', value: COMPOSE });
    expect(ctx.format()?.id).toBe('kubernetes');
  });

  it('host formats override built-ins by id', async () => {
    const mine = fake({ id: 'compose', label: 'Mine', detect: () => true });
    const { ctx } = await mount({ formats: [mine], value: COMPOSE });
    expect(ctx.format()).toBe(mine);
    const merged = mergeFormats(await loadBuiltinFormats(), [mine]);
    expect(merged.filter((f) => f.id === 'compose')).toEqual([mine]);
    expect(merged.map((f) => f.id)).toContain('kubernetes');
  });

  it('badge shows label and version', async () => {
    const { ctx } = await mount({ value: COMPOSE });
    const f = ctx.format()!;
    expect(badgeText(f)).toBe(`${f.label} ${f.version}`);
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe(`${f.label} ${f.version}`);
  });

  it('unknown explicit id resolves to no format', () => {
    expect(resolveFormat('nope', parseText(''), [fake()])).toBeUndefined();
  });

  it('guide override applies per format', async () => {
    const f = fake();
    const { ctx } = await mount({
      format: 'fake',
      formats: [f],
      guide: { fake: { fields: { 'D#a': { label: 'Mine' } } }, other: { fields: { 'D#a': { label: 'Nope' } } } },
    });
    expect(ctx.guide().fields['D#a']?.label).toBe('Mine');
    expect(f.guide.fields['D#a']?.label).toBe('Base');
  });

  it('guide is empty without a format', async () => {
    const { ctx } = await mount({});
    expect(ctx.guide()).toEqual({ groups: [], kinds: {}, fields: {} });
  });
});
