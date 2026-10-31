// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from '../../src/document/store.js';
import { createEditorWithContext } from '../../src/editor/editor.js';
import type { ManifestEditorOptions } from '../../src/editor/editor.js';
import type { VariableDecl } from '../../src/formats/types.js';
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
    expect(editor.applyFix(problem).ok).toBe(true);
    expect(editor.getValue()).toContain('x-variables:');
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toBe(true);;
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
    expect(vs.set({ name: 'HOST', type: 'string' }).ok).toBe(true);
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT', 'HOST']);
    expect(vs.set({ name: 'HOST', type: 'string' }, 'PORT').ok).toBe(false);
    expect(vs.set({ name: 'bad name', type: 'string' }).ok).toBe(false);
    expect(vs.remove('NOPE').ok).toBe(false);
    expect(editor.undo()).toBe(true);;
    expect(editor.getVariables().map((d) => d.name)).toEqual(['PORT']);
    expect(vs.remove('PORT').ok).toBe(true);
    expect(editor.getVariables()).toEqual([]);
    expect(editor.undo()).toBe(true);;
    expect(editor.getValue()).toBe(WITH_BLOCK);
  });

  it('is refused while the text does not parse, and while read-only', async () => {
    const { editor, ctx, fake } = await mount({ value: WITH_BLOCK });
    editor.setReadOnly(true);
    expect(ctx.variables()!.set({ name: 'A', type: 'string' }).ok).toBe(false);
    editor.setReadOnly(false);
    fake.type(WITH_BLOCK + 'a: [\n');
    expect(editor.getVariables()).toEqual([{ name: 'PORT', type: 'port' }]); // last good parse
    expect(ctx.variables()!.set({ name: 'A', type: 'string' }).ok).toBe(false);
  });
});

describe('flow-style x-variables entries', () => {
  const FLOW = 'x-variables:\n  WEB_PORT: { type: port, default: 8080, description: Public port }\n' + UNDECLARED.replace(/PORT/g, 'WEB_PORT');

  it('a type change that drops the default is one edit in flow style; one undo restores', async () => {
    const onVariablesChange = vi.fn();
    const { editor, ctx } = await mount({ value: FLOW, onVariablesChange });
    expect(ctx.variables()!.set({ name: 'WEB_PORT', type: 'boolean', description: 'Public port' }).ok).toBe(true);
    expect(editor.getValue()).toBe(FLOW.replace('{ type: port, default: 8080, description: Public port }', '{ type: boolean, description: Public port }'));
    expect(editor.getVariables()).toEqual([{ name: 'WEB_PORT', type: 'boolean', description: 'Public port' }]);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toBe(true);;
    expect(editor.getValue()).toBe(FLOW);
  });

  it('VariableStore multi-op set still commits once (now through transact)', async () => {
    const transact = vi.spyOn(DocumentStore.prototype, 'transact');
    const onVariablesChange = vi.fn();
    const { editor, ctx } = await mount({ value: FLOW, onVariablesChange });
    expect(ctx.variables()!.set({ name: 'WEB_PORT', type: 'boolean', description: 'Public port' }).ok).toBe(true);
    expect(transact).toHaveBeenCalledTimes(1);
    expect(transact.mock.calls[0]![0].length).toBeGreaterThan(1);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(editor.undo()).toBe(true);;
    expect(editor.getValue()).toBe(FLOW);
  });

  it('a refused op makes set change nothing and fire no onVariablesChange', async () => {
    const onVariablesChange = vi.fn();
    const text = FLOW.replace('default: 8080, description', 'default: 8080,\n    description');
    const { editor, ctx } = await mount({ value: text, onVariablesChange });
    expect(editor.getVariables()).toEqual([{ name: 'WEB_PORT', type: 'port', default: 8080, description: 'Public port' }]);
    // `set type` alone would succeed; `delete default` in a multi-line flow map is refused.
    expect(ctx.variables()!.set({ name: 'WEB_PORT', type: 'boolean', description: 'Public port' }).ok).toBe(false);
    expect(editor.getValue()).toBe(text);
    expect(editor.undo()).toBe(false);;
    expect(onVariablesChange).not.toHaveBeenCalled();
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
    expect(editor.applyFix(problem).ok).toBe(true);
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
    expect(vs.set({ name: 'B', type: 'number' }, 'A').ok).toBe(false);
    expect(vs.set({ name: 'C', type: 'number' }, 'A').ok).toBe(true);
    expect(vs.get().map((d) => d.name)).toEqual(['C', 'B']);
    expect(vs.set({ name: 'B', type: 'number' }).ok).toBe(true);
    expect(vs.get()).toHaveLength(2);
    expect(vs.remove('C').ok).toBe(true);
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
    expect(editor.applyFix(problem).ok).toBe(false);
    expect(editor.getValue()).toBe(DEPLOY);
    editor.setReadOnly(false);
    expect(editor.applyFix(problem).ok).toBe(true);
    expect(editor.getValue()).toContain('resources:');
    expect(editor.undo()).toBe(true);;
    expect(editor.getValue()).toBe(DEPLOY);
    expect(editor.applyFix({ ...problem, fix: undefined } as Problem).ok).toBe(false);
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

describe('declarations handed out are frozen', () => {
  const ENUM = { name: 'MODE', type: 'enum', enumValues: ['a', 'b'], default: 'a' } as const;
  const deeplyFrozen = (decls: readonly VariableDecl[]): boolean =>
    Object.isFrozen(decls) && decls.every((d) => Object.isFrozen(d) && (d.enumValues === undefined || Object.isFrozen(d.enumValues)));

  it.each(['x-variables', 'external'] as const)('%s store: getVariables, get() and every listener payload', async (store) => {
    const onVariablesChange = vi.fn();
    const value = store === 'external' ? undefined : 'x-variables:\n  MODE:\n    type: enum\n    enum: [a, b]\n    default: a\nservices: {}\n';
    const { editor, ctx } = await mount({
      ...(value !== undefined ? { value } : { value: 'services: {}\n', variables: { store: 'external', value: [ENUM] } }),
      onVariablesChange,
    });
    const heard: (readonly VariableDecl[])[] = [];
    ctx.onVariables((d) => heard.push(d));
    expect(editor.getVariables()).toEqual([ENUM]);
    expect(deeplyFrozen(editor.getVariables())).toBe(true);;
    expect(deeplyFrozen(ctx.variables()!.get())).toBe(true);;
    expect(ctx.variables()!.set({ name: 'B', type: 'boolean' }).ok).toBe(true);
    expect(heard).toHaveLength(1);
    expect(onVariablesChange).toHaveBeenCalledTimes(1);
    expect(deeplyFrozen(heard[0]!)).toBe(true);;
    expect(deeplyFrozen(onVariablesChange.mock.calls[0]![0] as readonly VariableDecl[])).toBe(true);;
    expect(editor.getVariables()).toEqual([ENUM, { name: 'B', type: 'boolean' }]);
  });

  it('the host list is copied: changing it afterwards changes nothing', async () => {
    const value: VariableDecl[] = [{ name: 'A', type: 'string' }];
    const { editor } = await mount({ variables: { store: 'external', value } });
    value.push({ name: 'B', type: 'string' });
    editor.setVariables(value);
    value.pop();
    expect(editor.getVariables().map((d) => d.name)).toEqual(['A', 'B']);
    expect(deeplyFrozen(editor.getVariables())).toBe(true);;
  });
});

describe('applyFix(edit) steps', () => {
  const YAML = 'a: 1\n';
  const fix = (ops: unknown[]) => ({ fix: { label: 'x', action: { kind: 'edit', ops } } }) as unknown as Problem;
  const add = (key: string) => ({ op: 'add', at: { doc: 0, path: [] }, key, value: 'v' });

  it('applies several ops as one undo step', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: YAML });
    expect(editor.applyFix(fix([add('b'), add('c')])).ok).toBe(true);
    expect(editor.getValue()).toBe('a: 1\nb: v\nc: v\n');
    expect(editor.undo()).toBe(true);;
    expect(editor.getValue()).toBe(YAML);
  });

  it('on a refused op returns false and changes nothing (all or nothing)', async () => {
    const { editor } = await mount({ format: 'kubernetes', value: YAML });
    const bad = { op: 'set', at: { doc: 0, path: ['nope', 'deeper'] }, value: 1 };
    expect(editor.applyFix(fix([add('b'), bad])).ok).toBe(false);
    expect(editor.getValue()).toBe(YAML);
    expect(editor.undo()).toBe(false);;
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
    expect(vs.set({ name: 'C', type: 'string' }).ok).toBe(false);
    expect(vs.remove('A').ok).toBe(false);
    expect(editor.applyFix(problem).ok).toBe(false);
    expect(ctx.applyFix(problem).ok).toBe(false);
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
    expect(vs.set({ name: 'A', type: 'string' }).ok).toBe(false);
    expect(editor.applyFix(fix).ok).toBe(false);
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
    expect(ctx.variables()!.set({ name: 'A', type: 'string' }).ok).toBe(true);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('onVariablesChange'), expect.any(Error));
  });
});

describe('action results', () => {
  const FLOW = 'x-variables:\n  WEB_PORT: { type: port, default: 8080,\n    description: Public port }\nservices:\n  web:\n    image: nginx\n';
  const declare = (name: string, type = 'string') =>
    ({ fix: { id: 'fix.declare-variable', label: '', action: { kind: 'declareVariable', decl: { name, type } } } }) as unknown as Problem;
  const A: VariableDecl = { name: 'A', type: 'string' };

  it('ok results are { ok: true }', async () => {
    const { editor, ctx } = await mount({ value: WITH_BLOCK });
    expect(ctx.variables()!.set({ name: 'B', type: 'string' })).toEqual({ ok: true });
    expect(ctx.variables()!.remove('B')).toEqual({ ok: true });
    expect(editor.applyFix(find(editor.getProblems(), 'rule.undeclared-variable') ?? declare('Z'))).toEqual({ ok: true });
  });

  it.each([
    [
      'read-only',
      async () => {
        const { editor, ctx } = await mount({ value: WITH_BLOCK });
        editor.setReadOnly(true);
        return [ctx.variables()!.set(A), ctx.variables()!.remove('PORT'), editor.applyFix(declare('Z'))];
      },
    ],
    [
      'destroyed',
      async () => {
        const { editor, ctx } = await mount({ value: WITH_BLOCK });
        const vs = ctx.variables()!;
        editor.destroy();
        return [vs.set(A), vs.remove('PORT'), editor.applyFix(declare('Z'))];
      },
    ],
    [
      'unavailable',
      async () => {
        const broken = await mount({ value: WITH_BLOCK });
        const vs = broken.ctx.variables()!;
        broken.fake.type('a: [\n');
        const kube = await mount({ format: 'kubernetes', value: 'a: 1\n' });
        return [vs.set(A), vs.remove('PORT'), kube.editor.applyFix(declare('Z'))];
      },
    ],
    [
      'invalid',
      async () => {
        const { ctx } = await mount({ value: WITH_BLOCK });
        return [ctx.variables()!.set({ name: 'bad name', type: 'string' })];
      },
    ],
    [
      'name-taken',
      async () => {
        const { ctx } = await mount({ value: WITH_BLOCK, variables: { store: 'external', value: [A, { name: 'B', type: 'string' }] } });
        return [ctx.variables()!.set({ name: 'B', type: 'string' }, 'A')];
      },
    ],
    [
      'not-found',
      async () => {
        const { ctx } = await mount({ value: WITH_BLOCK });
        return [ctx.variables()!.set(A, 'NOPE'), ctx.variables()!.remove('NOPE')];
      },
    ],
    [
      'already-declared',
      async () => {
        const { editor } = await mount({ value: WITH_BLOCK });
        return [editor.applyFix(declare('PORT'))];
      },
    ],
    [
      'no-fix',
      async () => {
        const { editor } = await mount({ value: WITH_BLOCK });
        return [editor.applyFix({ ...find(editor.getProblems(), 'rule.undeclared-variable')!, fix: undefined } as unknown as Problem)];
      },
    ],
  ] as const)('set/remove/applyFix report %s', async (reason, run) => {
    const results = await run();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r).toEqual({ ok: false, reason });
  });

  it('edit-refused carries the edit reason (flow) for set and for a fix', async () => {
    const { ctx, editor } = await mount({ value: FLOW });
    expect(ctx.variables()!.set({ name: 'WEB_PORT', type: 'boolean', description: 'Public port' })).toEqual({ ok: false, reason: 'edit-refused', edit: 'flow' });
    const pod = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: p\nspec:\n  containers:\n    - { name: web, image: nginx }\n';
    const kube = await mount({ format: 'kubernetes', value: pod });
    const fix = kube.editor.getProblems().find((p) => p.fix)!;
    expect(kube.editor.applyFix(fix)).toEqual({ ok: false, reason: 'edit-refused', edit: 'flow' });
    expect(editor.getValue()).toContain('WEB_PORT');
  });
});
