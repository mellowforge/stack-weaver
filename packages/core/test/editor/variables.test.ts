// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { Problem } from '../../src/validation/problems.js';
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

async function mount(options: ManifestEditorOptions = {}) {
  const adapter = createFakeAdapter();
  const made = createEditorWithContext(el, { codeEditor: adapter, format: 'compose', ...options });
  await made.editor.ready;
  return { ...made, fake: adapter.last! };
}

const WITH_BLOCK = 'x-variables:\n  PORT:\n    type: port\nservices:\n  web:\n    image: nginx\n    ports:\n      - "${PORT}:80"\n';
const UNDECLARED = 'services:\n  web:\n    image: nginx\n    ports:\n      - "${PORT}:80"\n';
const find = (ps: readonly Problem[], code: string) => ps.find((p) => p.code === code);

describe('x-variables store', () => {
  it('getVariables reads the block; a text edit of the block fires onVariablesChange once', async () => {
    const onVariablesChange = vi.fn();
    const { editor, fake } = await mount({ value: WITH_BLOCK, onVariablesChange });
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port' }]);
    expect(onVariablesChange).not.toHaveBeenCalled();
    fake.type(WITH_BLOCK.replace('type: port', 'type: string'));
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(onVariablesChange.mock.calls[0]![0]).toEqual([{ name: 'PORT', type: 'string' }]);
    fake.type(WITH_BLOCK.replace('type: port', 'type: string').replace('nginx', 'httpd')); // not the block
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
  });

  it('applyFix(declare) writes the block; one undo removes it and fires onVariablesChange', async () => {
    const onVariablesChange = vi.fn();
    const { editor } = await mount({ value: UNDECLARED, onVariablesChange });
    const problem = find(editor.getProblems(), 'rule.undeclared-variable')!;
    expect(problem.fix).toBeDefined();
    expect(editor.applyFix(problem)).toBe(true);
    expect(editor.getValue()).toContain('x-variables:');
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(UNDECLARED);
    expect(editor.getVariables()).toEqual([]);
    expect(onVariablesChange).toHaveBeenCalledTimes(2);
    expect(onVariablesChange.mock.calls[1]![0]).toEqual([]);
  });

  it('setVariables warns and changes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onVariablesChange = vi.fn();
    const { editor } = await mount({ value: WITH_BLOCK, onVariablesChange });
    editor.setVariables([{ name: 'OTHER', type: 'string' }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(editor.getValue()).toBe(WITH_BLOCK);
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port' }]);
    expect(onVariablesChange).not.toHaveBeenCalled();
  });

  it('set/remove through the context are one undo step each; renaming onto a taken name is refused', async () => {
    const { editor, ctx } = await mount({ value: WITH_BLOCK });
    const vs = ctx.variables()!;
    expect(vs.kind).toBe('x-variables');
    expect(vs.set({ name: 'HOST', type: 'string' })).toBe(true);
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT', 'HOST']);
    expect(vs.set({ name: 'HOST', type: 'string' }, 'PORT')).toBe(false);
    expect(vs.set({ name: 'bad name', type: 'string' })).toBe(false);
    expect(vs.remove('NOPE')).toBe(false);
    expect(editor.undo()).toBe(true);
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    expect(vs.remove('PORT')).toBe(true);
    expect(editor.getVariables()).toEqual([]);
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(WITH_BLOCK);
  });

  it('is refused while the text does not parse, and while read-only', async () => {
    const { editor, ctx, fake } = await mount({ value: WITH_BLOCK });
    editor.setReadOnly(true);
    expect(ctx.variables()!.set({ name: 'A', type: 'string' })).toBe(false);
    editor.setReadOnly(false);
    fake.type(WITH_BLOCK + 'a: [\n');
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port' }]); // last good parse
    expect(ctx.variables()!.set({ name: 'A', type: 'string' })).toBe(false);
  });
});

describe('external store', () => {
  it('initial value, getVariables, and an invalid initial value throws TypeError', async () => {
    const { editor } = await mount({ variables: { store: 'external', value: [{ name: 'PORT', type: 'port', default: 80 }] } });
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port', default: 80 }]);
    const bad = () => createEditorWithContext(document.createElement('div'), { variables: { store: 'external', value: [{ name: '1x', type: 'string' }] } });
    expect(bad).toThrow(TypeError);
    const dup = () =>
      createEditorWithContext(document.createElement('div'), {
        variables: { store: 'external', value: [{ name: 'A', type: 'string' }, { name: 'A', type: 'number' }] },
      });
    expect(dup).toThrow(TypeError);
  });

  it('applyFix(declare) leaves the text unchanged, fires onVariablesChange, and the undeclared problem disappears without typing', async () => {
    const onVariablesChange = vi.fn();
    const { editor } = await mount({ value: UNDECLARED, variables: { store: 'external', value: [] }, onVariablesChange });
    const problem = find(editor.getProblems(), 'rule.undeclared-variable')!;
    expect(problem).toBeDefined();
    expect(editor.applyFix(problem)).toBe(true);
    expect(editor.getValue()).toBe(UNDECLARED);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    await vi.waitFor(() => expect(find(editor.getProblems(), 'rule.undeclared-variable')).toBeUndefined());
  });

  it('setVariables re-validates, does not fire onVariablesChange, and throws on a duplicate name', async () => {
    const onVariablesChange = vi.fn();
    const { editor, ctx } = await mount({ value: UNDECLARED, variables: { store: 'external', value: [] }, onVariablesChange });
    const heard = vi.fn();
    ctx.onVariables(heard);
    expect(find(editor.getProblems(), 'rule.undeclared-variable')).toBeDefined();
    editor.setVariables([{ name: 'PORT', type: 'port' }]);
    expect(onVariablesChange).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(find(editor.getProblems(), 'rule.undeclared-variable')).toBeUndefined());
    expect(() => editor.setVariables([{ name: 'A', type: 'string' }, { name: 'A', type: 'string' }])).toThrow(TypeError);
    expect(() => editor.setVariables([{ name: 'A', type: 'enum' }])).toThrow(TypeError);
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port' }]);
  });

  it('set refuses a rename onto a taken name; same name replaces', async () => {
    const { ctx } = await mount({ variables: { store: 'external', value: [{ name: 'A', type: 'string' }, { name: 'B', type: 'string' }] } });
    const vs = ctx.variables()!;
    expect(vs.set({ name: 'B', type: 'number' }, 'A')).toBe(false);
    expect(vs.set({ name: 'C', type: 'number' }, 'A')).toBe(true);
    expect(vs.get().map((d) => d.name)).toEqual(['C', 'B']);
    expect(vs.set({ name: 'B', type: 'number' })).toBe(true);
    expect(vs.get()).toHaveLength(2);
    expect(vs.remove('C')).toBe(true);
  });
});

describe('kubernetes', () => {
  it('variables() is undefined and getVariables returns the external value or []', async () => {
    const k8s = 'apiVersion: v1\nkind: Service\n';
    const a = await mount({ format: 'kubernetes', value: k8s });
    expect(a.ctx.variables()).toBeUndefined();
    expect(a.editor.getVariables()).toEqual([]);
    a.editor.destroy();
    const b = await mount({ format: 'kubernetes', value: k8s, variables: { store: 'external', value: [{ name: 'X', type: 'string' }] } });
    expect(b.ctx.variables()).toBeUndefined();
    expect(b.editor.getVariables()).toEqual([{ name: 'X', type: 'string' }]);
  });
});

describe('applyFix', () => {
  const DEPLOY = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx
`;
  it('applies missing-resources as one undo step; read-only returns false', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: DEPLOY });
    const problem = editor.getProblems().find((p) => p.fix)!;
    expect(problem).toBeDefined();
    editor.setReadOnly(true);
    expect(editor.applyFix(problem)).toBe(false);
    expect(editor.getValue()).toBe(DEPLOY);
    editor.setReadOnly(false);
    expect(editor.applyFix(problem)).toBe(true);
    expect(editor.getValue()).toContain('resources:');
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(DEPLOY);
    expect(editor.applyFix({ ...problem, fix: undefined } as Problem)).toBe(false);
  });
});

describe('invalid initial declarations', () => {
  it('throw before any listener or DOM is set up', () => {
    const add = vi.fn();
    const mq = { matches: false, addEventListener: add, removeEventListener: vi.fn() };
    vi.spyOn(window, 'matchMedia').mockReturnValue(mq as unknown as MediaQueryList);
    el.innerHTML = '<i id="keep"></i>';
    expect(() => createEditorWithContext(el, { theme: 'auto', variables: { store: 'external', value: [{ name: '1x', type: 'string' }] } })).toThrow(TypeError);
    expect(add).not.toHaveBeenCalled();
    expect(el.querySelector('#keep')).not.toBeNull(); // the host element was not touched
  });
});

describe('applyFix(edit) steps', () => {
  const YAML = 'a: 1\n';
  const fix = (ops: unknown[]) => ({ fix: { label: 'x', action: { kind: 'edit', ops } } }) as unknown as Problem;
  const add = (key: string) => ({ op: 'add', at: { doc: 0, path: [] }, key, value: 'v' });

  it('applies several ops as one undo step', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: YAML });
    expect(editor.applyFix(fix([add('b'), add('c')]))).toBe(true);
    expect(editor.getValue()).toBe('a: 1\nb: v\nc: v\n');
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(YAML);
  });

  it('on a refused op returns false, keeps the earlier ops, and one undo reverts them', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: YAML });
    const bad = { op: 'set', at: { doc: 0, path: ['nope', 'deeper'] }, value: 1 };
    expect(editor.applyFix(fix([add('b'), bad]))).toBe(false);
    expect(editor.getValue()).toBe('a: 1\nb: v\n');
    expect(editor.undo()).toBe(true);
    expect(editor.getValue()).toBe(YAML);
  });
});

describe('destroy and failures', () => {
  it('a listener that destroys the editor stops the remaining callbacks', async () => {
    const onVariablesChange = vi.fn();
    const { editor, ctx } = await mount({ value: UNDECLARED, variables: { store: 'external', value: [] }, onVariablesChange });
    const later = vi.fn();
    ctx.onVariables(() => editor.destroy());
    ctx.onVariables(later);
    ctx.variables()!.set({ name: 'A', type: 'string' });
    expect(later).not.toHaveBeenCalled();
    expect(onVariablesChange).not.toHaveBeenCalled();
  });

  it('the external store is inert after destroy', async () => {
    const onVariablesChange = vi.fn();
    const { editor, ctx } = await mount({ value: UNDECLARED, variables: { store: 'external', value: [{ name: 'A', type: 'string' }] }, onVariablesChange });
    const heard = vi.fn();
    ctx.onVariables(heard);
    const vs = ctx.variables()!;
    const problem = find(editor.getProblems(), 'rule.undeclared-variable')!;
    editor.destroy();
    expect(() => editor.setVariables([{ name: 'B', type: 'string' }])).not.toThrow();
    expect(() => editor.setVariables([{ name: 'B', type: 'string' }, { name: 'B', type: 'string' }])).not.toThrow(); // destroyed: not even validated
    expect(vs.set({ name: 'C', type: 'string' })).toBe(false);
    expect(vs.remove('A')).toBe(false);
    expect(editor.applyFix(problem)).toBe(false);
    expect(ctx.applyFix(problem)).toBe(false);
    expect(onVariablesChange).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it('no variable callback after destroy', async () => {
    const onVariablesChange = vi.fn();
    const { editor, ctx, fake } = await mount({ value: WITH_BLOCK, onVariablesChange });
    const heard = vi.fn();
    ctx.onVariables(heard);
    const vs = ctx.variables()!;
    const fix = { fix: { label: '', action: { kind: 'declareVariable', decl: { name: 'A', type: 'string' } } } } as unknown as Problem;
    editor.destroy();
    fake.type(WITH_BLOCK.replace('type: port', 'type: string'));
    expect(vs.set({ name: 'A', type: 'string' })).toBe(false);
    expect(editor.applyFix(fix)).toBe(false);
    expect(onVariablesChange).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  it('a throwing onVariablesChange is logged', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ctx } = await mount({
      value: WITH_BLOCK,
      onVariablesChange: () => {
        throw new Error('boom');
      },
    });
    expect(ctx.variables()!.set({ name: 'A', type: 'string' })).toBe(true);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('onVariablesChange'), expect.any(Error));
  });
});
