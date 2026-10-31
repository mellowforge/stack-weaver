// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import { defaultUiMessages as ui } from '../../src/editor/messages.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';

let el: HTMLElement;
beforeEach(() => {
  el = document.createElement('div');
  document.body.append(el);
});
afterEach(() => {
  el.remove();
  vi.restoreAllMocks();
});

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
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY, mode: 'code' });
    await vi.waitFor(() => expect(adapter.mounts).toBe(1));
    editor.setValue(DEPLOY.replace('web', 'api'));
    editor.setReadOnly(true);
    editor.setTheme('dark');
    adapter.release();
    await editor.ready;
    const fake = adapter.last!;
    expect(fake.getText()).toContain('name: api');
    expect(fake.readOnly).toBe(true);
    expect(fake.theme).toBe('dark');
    editor.destroy();
  });

  it('destroy before an async mount resolves destroys the instance when it arrives', async () => {
    const adapter = createFakeAdapter({ async: 'manual' });
    const { editor } = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', value: DEPLOY });
    await vi.waitFor(() => expect(adapter.mounts).toBe(1));
    editor.destroy();
    adapter.release();
    await vi.waitFor(() => expect(adapter.last).toBeDefined());
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector('textarea')).toBeNull(); // the instance's destroy() removed it
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
