// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../../src/editor/context.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import { defaultUiMessages as ui } from '../../src/editor/messages.js';
import type { CodeEditorAdapter, CodeEditorInstance } from '../../src/editors/adapter.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';

let el: HTMLElement;
let unhandled: ReturnType<typeof vi.fn<(reason: unknown) => void>>;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
  unhandled = vi.fn<(reason: unknown) => void>();
  process.on('unhandledRejection', unhandled);
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 0));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
  el.remove();
  vi.restoreAllMocks();
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

describe('async adapter mount', () => {
  it('an async mount resolves before ready', async () => {
    const adapter = createFakeAdapter({ async: true });
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY });
    expect(adapter.last).toBeUndefined();
    await editor.ready;
    expect(adapter.last).toBeDefined();
    expect(adapter.last!.getText()).toBe(DEPLOY);
    editor.destroy();
  });

  it('state set while the mount is pending is applied once it arrives', async () => {
    const adapter = createFakeAdapter({ async: 'manual' });
    const onChange = vi.fn();
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY + 'x: [\n', mode: 'code', onChange });
    await vi.waitFor(() => expect(adapter.mounts).toBe(1));
    editor.setValue(DEPLOY.replace('web', 'api') + 'x: [\n');
    editor.setReadOnly(true);
    editor.setTheme('dark');
    editor.reveal({ doc: 0, path: ['spec', 'replicas'] });
    adapter.release();
    await editor.ready;
    const fake = adapter.last!;
    expect(fake.getText()).toContain('name: api');
    expect(fake.readOnly).toBe(true);
    expect(fake.theme).toBe('dark');
    expect(fake.diagnostics.some((d) => d.code === 'yaml.syntax')).toBe(true);
    expect(fake.revealed?.select).toBe(true);
    editor.setReadOnly(false);
    fake.type(fake.getText() + '# more\n');
    expect(editor.getValue()).toContain('# more');
    expect(onChange).toHaveBeenLastCalledWith(editor.getValue(), expect.anything());
    editor.destroy();
  });

  it('destroy before an async mount resolves destroys the instance when it arrives', async () => {
    const adapter = createFakeAdapter({ async: 'manual' });
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY });
    await vi.waitFor(() => expect(adapter.mounts).toBe(1));
    editor.destroy();
    adapter.release();
    await vi.waitFor(() => expect(adapter.last).toBeDefined());
    await vi.waitFor(() => expect(adapter.last!.destroyed).toBe(true));
    expect(adapter.last!.callsAfterDestroy).toEqual([]);
    expect(adapter.last!.diagnostics).toEqual([]); // nothing was pushed into it
    expect(adapter.last!.getText()).toBe(DEPLOY);
  });

  it('destroy while the default adapter is still loading: no mount, and ready resolves (B1)', async () => {
    const load = deferred<CodeEditorAdapter>();
    vi.spyOn(loaders, 'loadDefaultAdapter').mockReturnValue(load.promise);
    const adapter = createFakeAdapter();
    const { editor } = createEditorWithContext(el, { format: 'kubernetes', value: DEPLOY });
    editor.destroy();
    load.resolve(adapter);
    await expect(editor.ready).resolves.toBeUndefined();
    expect(adapter.mounts).toBe(0);
  });

  it('a mount that rejects after destroy is logged, shows nothing and lets ready resolve (B1)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mount = deferred<CodeEditorInstance>();
    const adapter: CodeEditorAdapter = { mount: () => mount.promise };
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY });
    await new Promise((r) => setTimeout(r, 0)); // the mount has started
    editor.destroy();
    const boom = new Error('late mount failure');
    mount.reject(boom);
    await expect(editor.ready).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('stack-weaver: the code editor failed to load', boom);
    expect(el.childElementCount).toBe(0); // no failure message in a destroyed editor
  });

  it('ready settles when the editor is destroyed right away (B1)', async () => {
    const { editor } = createEditorWithContext(el, { codeEditor: createFakeAdapter({ async: 'manual' }), format: 'kubernetes', value: DEPLOY });
    editor.destroy();
    await expect(editor.ready).resolves.toBeUndefined();
  });

  it('with ready rejected, setValue and update still work in visual mode (B1)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = vi.fn();
    const adapter = createFakeAdapter({ async: true, reject: new Error('no code editor') });
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'visual', value: DEPLOY, onChange });
    await expect(editor.ready).rejects.toThrow('no code editor');
    editor.setValue(DEPLOY.replace('web', 'api'));
    expect(editor.getValue()).toContain('name: api');
    editor.update({ value: DEPLOY, readOnly: true, mode: 'split' });
    expect(editor.getValue()).toBe(DEPLOY);
    expect(editor.getReadOnly()).toBe(true);
    expect(editor.getMode()).toBe('split');
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(editor.undo()).toBe(false); // read-only
    editor.setReadOnly(false);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toContain('name: api');
    editor.destroy();
  });

  it('two setFormat calls while an async mount is pending: the last one holds once it arrives (B1)', async () => {
    const adapter = createFakeAdapter({ async: 'manual' });
    const compose = 'services:\n  web:\n    image: nginx\n';
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'auto', value: DEPLOY });
    await vi.waitFor(() => expect(adapter.mounts).toBe(1));
    editor.setFormat('compose');
    editor.setValue(compose);
    editor.setFormat('kubernetes');
    expect(editor.getFormat()).toBe('kubernetes');
    adapter.release();
    await editor.ready;
    expect(editor.getActiveFormat()).toBe('kubernetes');
    expect(adapter.last!.getText()).toBe(compose);
    expect(el.querySelector('.sw-format-badge')!.textContent).toContain('Kubernetes');
    editor.destroy();
  });

  it('a rejected mount rejects ready and shows the failure', async () => {
    const boom = new Error('mount failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = createFakeAdapter({ async: true, reject: boom });
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY });
    await expect(editor.ready).rejects.toBe(boom);
    expect(el.querySelector('.sw-pane-code .sw-pane-error')!.textContent).toBe(ui.codeEditorFailed);
    expect(log).toHaveBeenCalledWith('stack-weaver: the code editor failed to load', boom);
    editor.destroy();
  });
});
