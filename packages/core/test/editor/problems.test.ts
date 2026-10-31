// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { breadcrumbAt } from '../../src/assist/hover.js';
import { DocumentStore } from '../../src/document/store.js';
import type { EditorContext } from '../../src/editor/context.js';
import { createEditorWithContext, createManifestEditor } from '../../src/editor/editor.js';
import { defaultUiMessages } from '../../src/editor/messages.js';
import { createProblemScheduler, VALIDATION_DELAY_MS } from '../../src/editor/problems.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { FormatDefinition, SchemaBundle } from '../../src/formats/types.js';
import type { Problem } from '../../src/validation/problems.js';
import { validateText } from '../../src/validation/validate.js';
import { parseText } from '../../src/document/parse.js';
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

  it('the published problems array is frozen: getProblems and onProblemsChange (R9)', async () => {
    const onProblemsChange = vi.fn();
    const editor = createManifestEditor(el, { codeEditor: createFakeAdapter(), format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n', onProblemsChange });
    expect(Object.isFrozen(editor.getProblems())).toBe(true); // the initial empty list too
    await editor.ready;
    expect(editor.getProblems()).toHaveLength(2);
    expect(Object.isFrozen(editor.getProblems())).toBe(true);
    expect(onProblemsChange.mock.calls[0]![0]).toBe(editor.getProblems());
    editor.destroy();
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
      loadSchema: (data) => {
        const kind = (data as { kind: string }).kind;
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

  it('a result for superseded text is never published, even before the next run starts', async () => {
    let release!: (b: SchemaBundle) => void;
    const custom: FormatDefinition = {
      ...twoErrors,
      id: 'kinds',
      rootModel: 'documents',
      loadSchema: (data) => {
        if ((data as { kind: string }).kind === 'Slow') return new Promise<SchemaBundle>((r) => (release = r));
        return Promise.resolve(bundle('fast', ['fast']));
      },
    };
    const onProblemsChange = vi.fn();
    const { fake } = await mount({ format: 'kinds', formats: [custom], value: 'apiVersion: v1\nkind: Fast\n', onProblemsChange });
    onProblemsChange.mockClear();
    vi.useFakeTimers();
    fake.type('apiVersion: v1\nkind: Slow\n');
    await vi.advanceTimersByTimeAsync(150); // A starts and waits for its schema
    fake.type('apiVersion: v1\nkind: Fast\nfast: 1\n'); // B arrives; its timer has not fired
    await vi.advanceTimersByTimeAsync(50);
    release(bundle('slow', ['slow', 'slower'])); // differs from the earlier problems, so it would publish
    await vi.advanceTimersByTimeAsync(10);
    expect(onProblemsChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(onProblemsChange).toHaveBeenCalledTimes(1);
    expect((onProblemsChange.mock.calls[0]![0] as Problem[]).map((p) => p.path)).toEqual([['fast']]);
  });

  it('a failed schema load recovers on a later run', async () => {
    let attempts = 0;
    const flaky: FormatDefinition = {
      ...twoErrors,
      id: 'flaky',
      loadSchema: async () => {
        if (++attempts <= 2) throw new Error('offline');
        return bundle('two', ['a']);
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { editor, fake } = await mount({ format: 'flaky', formats: [flaky], value: 'a: 1\n' });
    expect(editor.getProblems().map((p) => p.code)).toEqual(['schema.unavailable']);
    vi.useFakeTimers();
    fake.type('a: 2\n');
    await vi.advanceTimersByTimeAsync(150);
    expect(editor.getProblems().map((p) => p.code)).toEqual(['schema.type']);
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

  it('a format change validates now, not after the debounce (A10)', async () => {
    const detected: FormatDefinition = { ...twoErrors, detect: (input) => input.docs.some((d) => d !== undefined) };
    const onProblemsChange = vi.fn();
    const { editor } = await mount({ format: 'auto', formats: [detected], value: '', onProblemsChange });
    vi.useFakeTimers();
    editor.setValue('a: 1\nb: 2\n'); // detects the format, which validates at once
    await vi.advanceTimersByTimeAsync(1);
    expect(editor.getProblems()).toHaveLength(2);
    expect(onProblemsChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(onProblemsChange).toHaveBeenCalledTimes(1); // and no second run publishes the same thing
  });
});

describe('the editor validates like validateText', () => {
  const kinded: FormatDefinition = {
    ...twoErrors,
    id: 'kinded',
    rootModel: 'documents',
    loadSchema: async (data) => ((data as { kind?: unknown } | undefined)?.kind === 'A' ? bundle('a', ['x']) : undefined),
  };
  const texts = {
    'a keyless document after a kinded one': 'apiVersion: v1\nkind: A\nx: 1\n---\ny: 1\n',
    'a merged apiVersion and kind': 'base: &b\n  apiVersion: v1\n  kind: A\n---\n<<: *b\nx: 1\n',
  };
  for (const [name, value] of Object.entries(texts)) {
    it(name, async () => {
      const { editor } = await mount({ format: 'kinded', formats: [kinded], value });
      const direct = await validateText(parseText(value), kinded);
      const shape = (ps: readonly Problem[]) => ps.map((x) => [x.code, x.from, x.path]);
      expect(shape(editor.getProblems())).toEqual(shape(direct));
    });
  }
});

describe('the problem scheduler', () => {
  /** A scheduler over `store` whose schema loads wait until the test resolves them, in any order. */
  function setup(text: string) {
    const store = new DocumentStore(text);
    const loads: ((b: SchemaBundle) => void)[] = [];
    const ctx = {
      store,
      messages: { ui: defaultUiMessages, schema: {} },
      format: () => twoErrors,
      loadBundleByKey: () => new Promise<SchemaBundle | undefined>((r) => loads.push(r)),
      bundleErrorByKey: () => undefined,
      variables: () => undefined,
    } as unknown as EditorContext;
    const publish = vi.fn<(p: readonly Problem[]) => void>();
    return { store, loads, publish, scheduler: createProblemScheduler(ctx, publish) };
  }
  const paths = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls.at(-1)![0] as Problem[]).map((p) => p.path);

  it('of two overlapping runs for the same text, an older one that resolves last is not published (B8)', async () => {
    const { loads, publish, scheduler } = setup('a: 1\nb: 2\n');
    const older = scheduler.run();
    const newer = scheduler.run();
    loads[1]!(bundle('new', ['b']));
    await newer;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(paths(publish)).toEqual([['b']]);
    loads[0]!(bundle('old', ['a']));
    await older;
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('schedule() right after run() for the same text keeps that run (A10)', async () => {
    const { loads, publish, scheduler } = setup('a: 1\n');
    const run = scheduler.run();
    scheduler.schedule();
    loads[0]!(bundle('x', ['a']));
    await run;
    expect(publish).toHaveBeenCalledTimes(1);
    scheduler.destroy();
  });

  it('schedule() after the text changed still drops the run in flight', async () => {
    const { store, loads, publish, scheduler } = setup('a: 1\n');
    vi.useFakeTimers();
    const run = scheduler.run();
    store.setText('a: 2\n', 'code');
    scheduler.schedule();
    loads[0]!(bundle('x', ['a']));
    await run;
    expect(publish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    loads[1]!(bundle('y', ['b']));
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(paths(publish)).toEqual([['b']]);
  });
});

describe('problems UI', () => {
  it('problem count and live region update', async () => {
    await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n' });
    const count = el.querySelector('.sw-problem-count')!;
    expect(count.getAttribute('role')).toBe('status');
    expect(count.textContent).toBe('2 problems');
  });

  it('the problem count text follows locale and host plural table', async () => {
    await mount({
      format: 'two',
      formats: [twoErrors],
      value: 'a: 1\nb: 2\n',
      messages: {
        locale: 'ru',
        ui: { problemCount: { one: '{count} проблема', few: '{count} проблемы', many: '{count} проблем', other: '{count} проблемы' } },
      },
    });
    expect(el.querySelector('.sw-problem-count')!.textContent).toBe('2 проблемы');
  });

  it('ru plurals through the editor: 1, 5, 21 and 0 pick one, many, one and none (B8)', async () => {
    // One error per top-level key, so the text sets the count.
    const perKey: FormatDefinition = {
      ...twoErrors,
      id: 'per-key',
      loadSchema: async () => ({
        id: 'per-key',
        schema: {},
        validate: (data) => Object.keys(data as object).map((k) => ({ instancePath: `/${k}`, keyword: 'type', params: { type: 'string' }, message: `bad ${k}` })),
      }),
    };
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `k${i}: 1\n`).join('');
    const { editor } = await mount({
      format: 'per-key',
      formats: [perKey],
      value: keys(1),
      messages: { locale: 'ru', ui: { problemCount: { none: 'Нет проблем', one: '{count} проблема', few: '{count} проблемы', many: '{count} проблем', other: '{count} проблемы' } } },
    });
    const count = () => el.querySelector('.sw-problem-count')!.textContent;
    expect(count()).toBe('1 проблема');
    for (const [n, text] of [[5, '5 проблем'], [21, '21 проблема'], [0, 'Нет проблем']] as const) {
      editor.setValue(n === 0 ? '' : keys(n));
      await vi.waitFor(() => expect(count()).toBe(text));
    }
  });

  it.each(['', 'en_US', 'x', '*'])('an invalid locale %j falls back to English, with one warning', async (locale) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\nb: 2\n', messages: { locale } });
    expect(el.querySelector('.sw-problem-count')!.textContent).toBe('2 problems');
    expect(warn.mock.calls).toEqual([[`stack-weaver: locale "${locale}" is not valid; using "en"`]]);
  });

  it('a valid locale does not warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mount({ format: 'two', formats: [twoErrors], value: 'a: 1\n', messages: { locale: 'de-CH' } });
    expect(warn).not.toHaveBeenCalled();
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
    const info = await fake.init.hover!(text, start + 2);
    expect(info).toBeDefined();
    expect([info!.from, info!.to]).toEqual([start, start + 'metadata'.length]);
    expect(await fake.init.hover!(text, text.indexOf('v1'))).toBeUndefined();
  });

  it('breadcrumb follows the selection', async () => {
    const text = `${K8S}metadata:\n  name: x\n`;
    const { fake, ctx } = await mount({ format: 'kubernetes', value: text });
    const crumb = el.querySelector('.sw-breadcrumb')!;
    expect(crumb.getAttribute('aria-label')).toBe('Location');
    const at = text.indexOf('name');
    fake.setCaret(at);
    const parts = breadcrumbAt(ctx.store.parsed, at, undefined, ctx.guide());
    expect(parts.length).toBeGreaterThan(1);
    expect(crumb.textContent).toBe(parts.join(' › '));
  });

  it('the code breadcrumb names a kindless document with documentLabel', async () => {
    const text = 'a:\n  b: 1\n';
    const { fake } = await mount({ format: 'kubernetes', value: text, messages: { ui: { documentLabel: '{n}. Dokument' } } });
    fake.setCaret(text.indexOf('b'));
    expect(el.querySelector('.sw-breadcrumb')!.textContent).toBe('1. Dokument › a › b');
  });
});

describe('a same-length key rename (R13)', () => {
  it('republishes the problems with the new path: the row and the problems panel follow it', async () => {
    const value = 'services:\n  web:\n    image: 5\n';
    const { editor, ctx } = await mount({ format: 'compose', mode: 'visual', value });
    expect(editor.getProblems().map((p) => p.path)).toEqual([['services', 'web', 'image']]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The visual pane's key rename: one renameKey op; offsets, message and range stay the same.
    expect(ctx.store.edit({ op: 'renameKey', at: { doc: 0, path: ['services', 'web'] }, key: 'api' }).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(VALIDATION_DELAY_MS);
    await vi.waitFor(() => expect(editor.getProblems().map((p) => p.path)).toEqual([['services', 'api', 'image']]));
    // The problems panel reveals the new path in the visual pane, whose image row shows the error.
    el.querySelector<HTMLButtonElement>('.sw-problem')!.click();
    expect(el.querySelector('.sw-section-title')!.textContent).toContain('api');
    const shown = el.querySelector<HTMLElement>('.sw-row[data-sw-key="image"] .sw-row-problems')!;
    expect(shown.hidden).toBe(false);
    expect(shown.textContent).toContain(editor.getProblems()[0]!.message);
  });
});
