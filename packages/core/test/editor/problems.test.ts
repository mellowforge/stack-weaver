// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { breadcrumbAt } from '../../src/assist/hover.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { FormatDefinition, SchemaBundle } from '../../src/formats/types.js';
import type { Problem } from '../../src/validation/problems.js';
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

const guide = { groups: [], kinds: {}, fields: {} };
const bundle = (id: string, keys: string[]): SchemaBundle => ({
  id,
  schema: {},
  validate: () => keys.map((k) => ({ instancePath: `/${k}`, keyword: 'type', params: { type: 'string' }, message: `bad ${k}` })),
});
const twoErrors: FormatDefinition = {
  id: 'two',
  label: 'Two',
  version: '1',
  rootModel: 'mapping',
  detect: () => false,
  kinds: () => [],
  loadSchema: async () => bundle('two', ['a', 'b']),
  guide,
};

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, ...options });
  await made.editor.ready;
  return { ...made, adapter, fake: adapter.last! };
}

describe('validation scheduling', () => {
  it('validation runs 150 ms after the last change', async () => {
    const onProblemsChange = vi.fn();
    const { fake } = await mount({ format: 'kubernetes', value: 'apiVersion: v1\nkind: Service\n', onProblemsChange });
    onProblemsChange.mockClear();
    vi.useFakeTimers();
    fake.type('a: [\n');
    await vi.advanceTimersByTimeAsync(100);
    fake.type('a: [\n  b\n');
    await vi.advanceTimersByTimeAsync(149);
    expect(onProblemsChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onProblemsChange).toHaveBeenCalledTimes(1);
    expect(onProblemsChange.mock.calls[0]![0].some((p: Problem) => p.code === 'yaml.syntax')).toBe(true);
  });

  it('ready waits for the first validation', async () => {
    const { editor } = await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    expect(editor.getProblems()).toHaveLength(2);
  });

  it('stale results are dropped', async () => {
    let release!: (b: SchemaBundle) => void;
    const custom: FormatDefinition = {
      ...twoErrors,
      id: 'kinds',
      rootModel: 'documents',
      loadSchema: (p, doc) => {
        const kind = p.docs[doc]!.get('kind') as string;
        if (kind === 'Slow') return new Promise<SchemaBundle>((r) => (release = r));
        return Promise.resolve(bundle('fast', ['fast']));
      },
    };
    const onProblemsChange = vi.fn();
    const { fake } = await mount({ format: 'kinds', formats: [custom], value: 'apiVersion: v1\nkind: Fast\n', onProblemsChange });
    onProblemsChange.mockClear();
    vi.useFakeTimers();
    fake.type('apiVersion: v1\nkind: Slow\n');
    await vi.advanceTimersByTimeAsync(150); // A starts and waits for its schema
    fake.type('apiVersion: v1\nkind: Fast\nfast: 1\n');
    await vi.advanceTimersByTimeAsync(150); // B runs and publishes
    expect(onProblemsChange).toHaveBeenCalledTimes(1);
    release(bundle('slow', ['slow']));
    await vi.advanceTimersByTimeAsync(10);
    expect(onProblemsChange).toHaveBeenCalledTimes(1);
    const last = onProblemsChange.mock.calls[0]![0] as Problem[];
    expect(last.map((p) => p.path)).toEqual([['fast']]);
  });

  it('diagnostics reach the adapter', async () => {
    const { fake } = await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    expect(fake.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['error', 'Must be a string'],
      ['error', 'Must be a string'],
    ]);
  });

  it('broken YAML shows yaml.syntax problems', async () => {
    const { editor, fake } = await mount({ format: 'kubernetes', value: 'apiVersion: v1\nkind: Service\n' });
    vi.useFakeTimers();
    fake.type('a: [\n');
    await vi.advanceTimersByTimeAsync(150);
    expect(editor.getProblems().map((p) => p.code)).toContain('yaml.syntax');
    expect(fake.diagnostics.length).toBeGreaterThan(0);
  });

  it('broken YAML shows yaml.syntax problems even before a format is detected', async () => {
    const { editor } = await mount({ value: 'a: [\n' });
    expect(editor.getProblems().map((p) => p.code)).toContain('yaml.syntax');
  });

  it('a rejected schema load is a schema.unavailable error', async () => {
    const bad: FormatDefinition = { ...twoErrors, id: 'bad', loadSchema: () => Promise.reject(new Error('offline')) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { editor } = await mount({ format: 'bad', formats: [bad], value: 'a: 1\n' });
    expect(editor.getProblems().map((p) => [p.severity, p.code])).toEqual([['error', 'schema.unavailable']]);
  });

  it('onProblems listeners are told and can unsubscribe', async () => {
    const { ctx, fake } = await mount({ format: 'kubernetes', value: 'apiVersion: v1\nkind: Service\n' });
    const fn = vi.fn();
    const off = ctx.onProblems(fn);
    vi.useFakeTimers();
    fake.type('a: [\n');
    await vi.advanceTimersByTimeAsync(150);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    fake.type('a: 2\n');
    await vi.advanceTimersByTimeAsync(150);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('problems UI', () => {
  it('problem count and live region update', async () => {
    await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    const count = el.querySelector('.sw-problem-count')!;
    expect(count.getAttribute('role')).toBe('status');
    expect(count.textContent).toBe('2 problems');
  });

  it('count says "No problems" when clean', async () => {
    await mount({ format: 'kubernetes', value: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: demo\n' });
    expect(el.querySelector('.sw-problem-count')!.textContent).toBe('No problems');
  });

  it('problems panel lists problems and click reveals the range in code', async () => {
    const { editor, fake } = await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    const items = el.querySelectorAll<HTMLButtonElement>('.sw-problems button.sw-problem');
    expect(items).toHaveLength(2);
    expect(items[1]!.textContent).toContain('Must be a string');
    expect(items[1]!.textContent).toContain('2:4');
    expect(items[1]!.textContent).toContain('Error');
    items[1]!.click();
    const p = editor.getProblems()[1]!;
    expect(fake.revealed).toEqual({ range: { from: p.from, to: p.to }, select: true });
  });

  it('the panel collapses', async () => {
    await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    const toggle = el.querySelector<HTMLButtonElement>('.sw-problems-toggle')!;
    const list = el.querySelector<HTMLElement>('.sw-problem-list')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
  });

  it('never renders problem text as markup', async () => {
    await mount({
      format: 'two',
      formats: [twoErrors],
      value: 'a: 1\n',
      messages: { schema: { type: () => '<img src=x onerror=alert(1)>' } },
    });
    expect(el.querySelector('.sw-problems img')).toBeNull();
    expect(el.querySelector('.sw-problems')!.textContent).toContain('<img');
  });
});

describe('code assist', () => {
  const K8S = 'apiVersion: v1\nkind: Service\n';

  it('completion source returns completionsFor results through the adapter', async () => {
    const { fake } = await mount({ format: 'kubernetes', value: K8S });
    fake.setCaret(K8S.length);
    const labels = await fake.requestCompletions();
    expect(labels).toContain('metadata');
    expect(labels).toContain('spec');
    expect(labels).not.toContain('kind');
  });

  it('completion offers nothing once the text moved on', async () => {
    const { fake } = await mount({ format: 'kubernetes', value: K8S });
    const pending = fake.init.complete!(K8S, K8S.length, true);
    fake.type('a: 1\n');
    await expect(pending).resolves.toBeNull();
  });

  it('hover source returns hoverAt', async () => {
    const text = `${K8S}metadata:\n  name: x\n`;
    const { fake } = await mount({ format: 'kubernetes', value: text });
    const start = text.indexOf('metadata');
    const info = fake.init.hover!(text, start + 2);
    expect(info).toBeDefined();
    expect([info!.from, info!.to]).toEqual([start, start + 'metadata'.length]);
    expect(fake.init.hover!(text, text.indexOf('v1'))).toBeUndefined();
  });

  it('breadcrumb follows the selection', async () => {
    const text = `${K8S}metadata:\n  name: x\n`;
    const { fake, ctx } = await mount({ format: 'kubernetes', value: text });
    const crumb = el.querySelector('.sw-breadcrumb')!;
    expect(crumb.getAttribute('aria-label')).toBe('Location');
    const at = text.indexOf('name');
    fake.setCaret(at);
    const parts = breadcrumbAt(ctx.store.parsed, at);
    expect(parts.length).toBeGreaterThan(1);
    expect(crumb.textContent).toBe(parts.join(' › '));
  });
});
