// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../../src/editor/context.js';
import { createEditorWithContext, createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorController, ManifestEditorOptions } from '../../src/editor/editor.js';
import type { FormatDefinition, VariableDecl } from '../../src/formats/types.js';
import { defaultUiMessages as ui } from '../../src/editor/messages.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const K8S = 'apiVersion: v1\nkind: Service\nmetadata:\n  name: x\n';
const COMPOSE = 'services:\n  web:\n    image: nginx\n';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, ...options });
  await made.editor.ready;
  return { ...made, fake: adapter.last! };
}
const badge = () => el.querySelector('.sw-format-badge')!.textContent;

const fakeFormat = (over: Partial<FormatDefinition> = {}): FormatDefinition => ({
  id: 'mine',
  label: 'Mine',
  version: '1',
  rootModel: 'mapping',
  detect: () => false,
  kinds: () => [],
  loadSchema: async () => undefined,
  guide: { groups: [], kinds: {}, fields: {} },
  ...over,
});

describe('update and setValue', () => {
  it('update({ value }) with the current text fires nothing and adds no history', async () => {
    const onChange = vi.fn();
    const { editor, ctx } = await mount({ value: K8S, onChange });
    editor.update({ value: K8S });
    editor.setValue(K8S);
    expect(onChange).not.toHaveBeenCalled();
    expect(ctx.store.canUndo).toBe(false);
  });

  it('update({ value }) is setValue: origin api, one undo step', async () => {
    const onChange = vi.fn();
    const { editor, ctx } = await mount({ value: K8S, onChange });
    editor.update({ value: K8S.replace('x', 'y') });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(K8S.replace('x', 'y'), { origin: 'api' });
    expect(ctx.store.canUndo).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(K8S);
  });

  it('a minimal-diff update keeps the code caret', async () => {
    const { editor, fake } = await mount({ value: K8S });
    const caret = K8S.indexOf('Service') + 3;
    fake.setCaret(caret);
    editor.update({ value: K8S.replace('name: x', 'name: xyz') }); // after the caret
    expect(fake.getText()).toBe(K8S.replace('name: x', 'name: xyz'));
    expect(fake.selection).toEqual({ from: caret, to: caret });
  });

  it('an empty patch is a no-op', async () => {
    const onChange = vi.fn();
    const onModeChange = vi.fn();
    const { editor } = await mount({ value: K8S, onChange, onModeChange });
    editor.update({});
    expect(onChange).not.toHaveBeenCalled();
    expect(onModeChange).not.toHaveBeenCalled();
    expect(editor.getFormat()).toBe('kubernetes');
  });

  it('update applies several fields at once in the documented order', async () => {
    // Order: format, value, variables, readOnly, mode, theme. Each callback records what was already applied.
    const seen: string[] = [];
    const decl: VariableDecl = { name: 'PORT', type: 'port' };
    const editor: ManifestEditorController = createManifestEditor(el, {
      codeEditor: createFakeAdapter(),
      value: K8S,
      theme: 'light',
      variables: { store: 'external', value: [] },
      onChange: () => seen.push(`value format=${editor.getFormat()} vars=${editor.getVariables().length} ro=${editor.getReadOnly()}`),
      onModeChange: () =>
        seen.push(`mode vars=${editor.getVariables().length} ro=${editor.getReadOnly()} theme=${el.querySelector('.sw-editor')!.getAttribute('data-sw-theme')}`),
    });
    await editor.ready;
    editor.update({ theme: 'dark', mode: 'code', readOnly: true, variables: [decl], value: COMPOSE, format: 'kubernetes' });
    // `format` came first: the compose text did not switch the (now fixed) format.
    expect(seen).toEqual(['value format=kubernetes vars=0 ro=false', 'mode vars=1 ro=true theme=light']);
    expect(editor.getFormat()).toBe('kubernetes');
    expect(editor.getValue()).toBe(COMPOSE);
    expect(editor.getVariables()).toEqual([decl]);
    expect(editor.getReadOnly()).toBe(true);
    expect(editor.getMode()).toBe('code');
    expect(el.querySelector('.sw-editor')!.getAttribute('data-sw-theme')).toBe('dark');
    editor.destroy();
  });

  it('update({ variables }) under the x-variables store warns and changes nothing (D5)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { editor } = await mount({ value: COMPOSE });
    editor.update({ variables: [{ name: 'PORT', type: 'port' }] });
    expect(warn).toHaveBeenCalledOnce();
    expect(editor.getVariables()).toEqual([]);
    expect(editor.getValue()).toBe(COMPOSE);
  });

  it('update after destroy does nothing', async () => {
    const onChange = vi.fn();
    const { editor } = await mount({ value: K8S, onChange });
    editor.destroy();
    expect(() => editor.update({ value: COMPOSE, format: 'compose', mode: 'code', readOnly: true, theme: 'dark' })).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('format at runtime (P8)', () => {
  it('getFormat is undefined until the format resolves', async () => {
    const editor = createManifestEditor(el, { codeEditor: createFakeAdapter(), value: K8S });
    expect(editor.getFormat()).toBeUndefined();
    await editor.ready;
    expect(editor.getFormat()).toBe('kubernetes');
    editor.destroy();
  });

  it('update({ value }) with a compose text switches an auto editor from kubernetes to compose', async () => {
    const { editor, ctx } = await mount({ value: K8S });
    expect(editor.getFormat()).toBe('kubernetes');
    editor.update({ value: COMPOSE });
    expect(editor.getFormat()).toBe('compose');
    expect(ctx.format()?.id).toBe('compose');
    expect(badge()).toContain('Docker Compose');
    editor.setValue(K8S);
    expect(editor.getFormat()).toBe('kubernetes');
  });

  it('a store reset re-detects under auto', async () => {
    const { editor, ctx } = await mount({ value: K8S });
    ctx.store.reset(COMPOSE);
    expect(editor.getFormat()).toBe('compose');
  });

  it('an api text that detects as no format drops the format; broken text keeps it', async () => {
    const { editor } = await mount({ value: K8S });
    editor.setValue(K8S + 'bad: [unclosed\n');
    expect(editor.getFormat()).toBe('kubernetes');
    editor.setValue('just: data\n');
    expect(editor.getFormat()).toBeUndefined();
    expect(badge()).toBe(ui.formatNone);
  });

  it('typing compose text into an auto kubernetes editor does not switch', async () => {
    const { editor, fake } = await mount({ value: K8S });
    fake.type(COMPOSE);
    expect(editor.getValue()).toBe(COMPOSE);
    expect(editor.getFormat()).toBe('kubernetes');
  });

  it('setFormat fixes the format; setFormat("auto") re-detects', async () => {
    const { editor, fake } = await mount({ value: K8S });
    editor.setFormat('compose');
    expect(editor.getFormat()).toBe('compose');
    expect(badge()).toContain('Docker Compose');
    // Fixed: neither an api text nor clearing the text changes it.
    editor.setValue(K8S.replace('x', 'y'));
    editor.setValue('');
    expect(editor.getFormat()).toBe('compose');
    editor.setValue(K8S);
    editor.setFormat('auto');
    expect(editor.getFormat()).toBe('kubernetes');
    // Auto again: typing keeps the format, setFormat('auto') re-detects the typed text.
    fake.type(COMPOSE);
    expect(editor.getFormat()).toBe('kubernetes');
    editor.setFormat('auto');
    expect(editor.getFormat()).toBe('compose');
    editor.update({ format: 'kubernetes' });
    expect(editor.getFormat()).toBe('kubernetes');
  });

  it('setFormat with an unknown id resolves to no format, like the option', async () => {
    const { editor } = await mount({ value: K8S });
    editor.setFormat('nope');
    await vi.waitFor(() => expect(badge()).toBe(ui.formatNone));
    expect(editor.getFormat()).toBeUndefined();
  });

  it('setFormat before the formats load is honoured when they do', async () => {
    const editor = createManifestEditor(el, { codeEditor: createFakeAdapter(), value: K8S });
    editor.setFormat('compose');
    await editor.ready;
    expect(editor.getFormat()).toBe('compose');
    editor.destroy();
  });

  it('setFormat loads the built-in formats when only host formats were needed', async () => {
    const load = vi.spyOn(loaders, 'loadBuiltinFormats');
    const mine = fakeFormat();
    const { editor } = await mount({ format: 'mine', formats: [mine], value: K8S });
    expect(load).not.toHaveBeenCalled();
    expect(editor.getFormat()).toBe('mine');
    editor.setFormat('kubernetes');
    await vi.waitFor(() => expect(editor.getFormat()).toBe('kubernetes'));
    expect(load).toHaveBeenCalledOnce();
    editor.setFormat('auto');
    expect(editor.getFormat()).toBe('kubernetes');
    editor.setFormat('mine');
    expect(editor.getFormat()).toBe('mine');
  });

  it('ready waits for built-in formats a setFormat made while loading needs', async () => {
    const editor = createManifestEditor(el, { codeEditor: createFakeAdapter(), format: 'mine', formats: [fakeFormat()], value: K8S });
    editor.setFormat('kubernetes');
    await editor.ready;
    expect(editor.getFormat()).toBe('kubernetes');
    editor.destroy();
  });

  it('a later setFormat wins over one still waiting for the built-in formats', async () => {
    const mine = fakeFormat();
    const { editor } = await mount({ format: 'mine', formats: [mine], value: K8S });
    editor.setFormat('kubernetes');
    editor.setFormat('mine');
    await new Promise((r) => setTimeout(r, 0));
    await vi.waitFor(() => expect(editor.getFormat()).toBe('mine'));
    await new Promise((r) => setTimeout(r, 20));
    expect(editor.getFormat()).toBe('mine');
  });

  it('the built-in formats failing to load for setFormat is logged and shown', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('chunk failed');
    const { editor } = await mount({ format: 'mine', formats: [fakeFormat()], value: K8S });
    vi.spyOn(loaders, 'loadBuiltinFormats').mockRejectedValue(boom);
    editor.setFormat('kubernetes');
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('stack-weaver: loading the built-in formats failed', boom));
    expect(editor.getFormat()).toBeUndefined();
    expect(badge()).toBe(ui.formatsFailed);
  });

  it('a format change reports the declarations it changes', async () => {
    const onVariablesChange = vi.fn();
    const text = 'x-variables:\n  PORT:\n    type: port\n' + COMPOSE;
    const { editor } = await mount({ value: text, onVariablesChange });
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    editor.setFormat('kubernetes');
    expect(editor.getVariables()).toEqual([]);
    expect(onVariablesChange).toHaveBeenLastCalledWith([]);
    editor.setFormat('compose');
    expect(onVariablesChange).toHaveBeenLastCalledWith([expect.objectContaining({ name: 'PORT' })]);
  });

  it('setFormat after destroy does nothing', async () => {
    const { editor } = await mount({ value: K8S });
    editor.destroy();
    editor.setFormat('compose');
    expect(editor.getFormat()).toBe('kubernetes');
  });
});
