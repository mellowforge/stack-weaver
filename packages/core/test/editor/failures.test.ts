// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loaders } from '../../src/editor/context.js';
import { createEditorWithContext, createManifestEditor } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import { defaultUiMessages as ui } from '../../src/editor/messages.js';
import { kubernetesFormat } from '../../src/formats/kubernetes/index.js';
import type { FormatDefinition } from '../../src/formats/types.js';
import type { WidgetContext, WidgetFactory } from '../../src/visual/widgets/types.js';
import { createFakeAdapter } from '../helpers/fake-adapter.js';

const DEPLOY = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n';
const replicasAt = { doc: 0, path: ['spec', 'replicas'] };

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

const settle = () => new Promise((r) => setTimeout(r, 0));
const outlineClick = (label: string) =>
  [...el.querySelectorAll<HTMLElement>('[role=treeitem] .sw-outline-label')].find((l) => l.textContent === label)!.click();
const row = (key: string) => el.querySelector<HTMLElement>(`.sw-section .sw-row[data-sw-key="${key}"]`)!;

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'kubernetes', mode: 'split', value: DEPLOY, ...options });
  await made.editor.ready;
  await settle();
  return { ...made, fake: adapter.last! };
}

/** An integer widget whose `update` throws once the value is `bad`. */
const throwingUpdate = (bad: unknown): WidgetFactory => (ctx: WidgetContext) => {
  const input = document.createElement('input');
  input.id = ctx.id;
  input.className = 'host-widget';
  input.value = String(ctx.value);
  return {
    el: input,
    update(value) {
      if (value === bad) throw new Error('host widget update failed');
      input.value = String(value);
    },
    focus: () => input.focus(),
  };
};

describe('a pane that throws during an update (A5)', () => {
  it('a host widget whose update throws: onChange, history and the row still work', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = vi.fn();
    const { ctx, editor, fake } = await mount({ onChange, widgets: { integer: throwingUpdate(3) } });
    outlineClick('spec');
    expect(row('replicas').querySelector('.host-widget')).not.toBeNull();

    const r = ctx.store.edit({ op: 'set', at: replicasAt, value: 3 });

    expect(r.ok).toBe(true);
    const three = DEPLOY.replace('replicas: 2', 'replicas: 3');
    expect(onChange).toHaveBeenLastCalledWith(three, { origin: 'visual' });
    expect(fake.getText()).toBe(three);
    expect(log).toHaveBeenCalledWith('stack-weaver: the "integer" widget failed', expect.any(Error));
    // The row falls back to read-only text, says why and offers the code.
    expect(row('replicas').querySelector('.host-widget')).toBeNull();
    expect(row('replicas').querySelector('.sw-row-value')!.textContent).toBe('3');
    const note = row('replicas').querySelector<HTMLElement>('.sw-row-failed')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain(ui.widgetFailed);
    expect(note.querySelector('.sw-link')!.textContent).toBe(ui.editInCode);

    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(DEPLOY);
    expect(fake.getText()).toBe(DEPLOY);
    expect(onChange).toHaveBeenLastCalledWith(DEPLOY, { origin: 'history' });
  });

  it('a throwing onChange callback is logged and does not break the edit', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx, fake } = await mount({
      onChange: () => {
        throw new Error('host onChange failed');
      },
    });
    expect(() => ctx.store.edit({ op: 'set', at: replicasAt, value: 4 })).not.toThrow();
    expect(fake.getText()).toBe(DEPLOY.replace('replicas: 2', 'replicas: 4'));
    expect(log).toHaveBeenCalledWith('stack-weaver: an onChange callback threw', expect.any(Error));
  });
});

describe('a failed lazy load is shown, logged and never unhandled (A6)', () => {
  it('the default code editor failing to load', async () => {
    const boom = new Error('chunk failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(loaders, 'loadDefaultAdapter').mockRejectedValue(boom);
    const editor = createManifestEditor(el, { format: 'kubernetes', value: 'a: [\n' });
    await expect(editor.ready).rejects.toBe(boom);
    const message = el.querySelector<HTMLElement>('.sw-pane-code .sw-pane-error')!;
    expect(message.textContent).toBe(ui.codeEditorFailed);
    expect(message.getAttribute('role')).toBe('alert');
    expect(log).toHaveBeenCalledWith('stack-weaver: the code editor failed to load', boom);
    // The rest of the editor still works: the first validation ran.
    expect(editor.getProblems().some((p) => p.code === 'yaml.syntax')).toBe(true);
    editor.destroy();
  });

  it('a host adapter whose mount throws', async () => {
    const boom = new Error('mount failed');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const editor = createManifestEditor(el, {
      format: 'kubernetes',
      value: DEPLOY,
      codeEditor: {
        mount() {
          throw boom;
        },
      },
    });
    await expect(editor.ready).rejects.toBe(boom);
    expect(el.querySelector('.sw-pane-code .sw-pane-error')!.textContent).toBe(ui.codeEditorFailed);
    editor.setValue(DEPLOY.replace('web', 'api')); // the editor keeps working without a code pane
    expect(editor.getValue()).toContain('name: api');
    editor.destroy();
  });

  it('a rejected ready is not unhandled when the host never awaits it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(loaders, 'loadDefaultAdapter').mockRejectedValue(new Error('chunk failed'));
    const editor = createManifestEditor(el, { format: 'kubernetes', value: DEPLOY });
    await vi.waitFor(() => expect(el.querySelector('.sw-pane-error')).not.toBeNull());
    await settle();
    editor.destroy();
  });

  it('the built-in formats failing to load', async () => {
    const boom = new Error('formats chunk failed');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(loaders, 'loadBuiltinFormats').mockRejectedValue(boom);
    const adapter = createFakeAdapter();
    const editor = createManifestEditor(el, { codeEditor: adapter, value: DEPLOY });
    await expect(editor.ready).rejects.toBe(boom);
    expect(el.querySelector('.sw-format-badge')!.textContent).toBe(ui.formatsFailed);
    const empty = el.querySelector<HTMLElement>('.sw-visual-empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe(ui.formatsFailed);
    expect(log).toHaveBeenCalledWith('stack-weaver: loading the built-in formats failed', boom);
    expect(adapter.last!.getText()).toBe(DEPLOY); // the code editor still works
    editor.destroy();
  });

  it('nothing is shown or logged when destroyed before the load fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reject!: (e: unknown) => void;
    vi.spyOn(loaders, 'loadDefaultAdapter').mockReturnValue(new Promise((_, r) => (reject = r)));
    const editor = createManifestEditor(el, { format: 'kubernetes', value: DEPLOY });
    editor.destroy();
    reject(new Error('late'));
    await settle();
    expect(el.childNodes.length).toBe(0);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('schema and widget failures are not silent (A7)', () => {
  it('a section whose schema failed to load says so, links to the code, and a later render retries', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const flaky: FormatDefinition = {
      ...kubernetesFormat,
      loadSchema: (data) => (fail ? Promise.reject(new Error('offline')) : kubernetesFormat.loadSchema(data)),
    };
    const loadSchema = vi.spyOn(flaky, 'loadSchema');
    const { editor, ctx, fake } = await mount({ formats: [flaky] });
    outlineClick('spec');
    const note = el.querySelector<HTMLElement>('.sw-section-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain(ui.schemaFailed);
    expect(row('replicas').querySelector('input')).toBeNull(); // read-only text
    note.querySelector<HTMLButtonElement>('.sw-link')!.click();
    expect(fake.revealed?.range.from).toBe(DEPLOY.indexOf('spec:'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('loading the schema'), expect.any(Error));

    fail = false;
    const calls = loadSchema.mock.calls.length;
    editor.setValue(DEPLOY.replace('web', 'api')); // a later render retries the load
    await vi.waitFor(() => expect(row('replicas').querySelector('input')).not.toBeNull());
    expect(loadSchema.mock.calls.length).toBeGreaterThan(calls);
    expect(ctx.bundleError(0)).toBeUndefined();
    expect(el.querySelector<HTMLElement>('.sw-section-note')!.hidden).toBe(true);
  });

  it('a widget factory that throws leaves a note with "Edit in code"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom: WidgetFactory = () => {
      throw new Error('factory failed');
    };
    const { fake, editor } = await mount({ widgets: { integer: boom } });
    outlineClick('spec');
    const note = row('replicas').querySelector<HTMLElement>('.sw-row-failed')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain(ui.widgetFailed);
    note.querySelector<HTMLButtonElement>('.sw-link')!.click();
    const { from, to } = fake.revealed!.range;
    expect(editor.getValue().slice(from, to)).toBe('2');
  });

  it('a section without failures shows no schema note', async () => {
    await mount();
    outlineClick('spec');
    expect(el.querySelector<HTMLElement>('.sw-section-note')!.hidden).toBe(true);
    expect(row('replicas').querySelector<HTMLElement>('.sw-row-failed')!.hidden).toBe(true);
  });
});
