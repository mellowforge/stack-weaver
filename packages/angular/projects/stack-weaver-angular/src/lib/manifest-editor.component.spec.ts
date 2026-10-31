import { Component, ErrorHandler, NgZone, Type, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import type {
  ChangeOrigin,
  CodeEditorAdapter,
  EditorMode,
  EditorTheme,
  FormatDefinition,
  ManifestEditorController,
  ManifestEditorOptions,
  Problem,
  Recipe,
  VariableDecl,
  VariablesOption,
  WidgetRegistry,
} from '@stack-weaver/core';
import { EXAMPLES, textareaAdapter } from '@stack-weaver/demo-kit';
import type { TextareaAdapter } from '@stack-weaver/demo-kit';
import { SwManifestEditor } from './manifest-editor.component';

const COMPOSE = EXAMPLES.find((e) => e.id === 'compose')!.value;
const KUBERNETES = EXAMPLES.find((e) => e.id === 'kubernetes')!.value;
/** A Kubernetes document with a schema problem: `containers` must be a list. */
const INVALID_POD = 'apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers: 3\n';

/** Node's `process` (vitest runs in Node), typed for the one event the tests listen to. */
const node = (globalThis as unknown as {
  process: {
    on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
    off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  };
}).process;

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;
/** The code editor the next host is created with. */
let codeEditor: CodeEditorAdapter;

type History = { readonly canUndo: boolean; readonly canRedo: boolean };

/** The init-only inputs other than `codeEditor`, `guide` and `messages`. */
type InitOnly = {
  readonly formats?: readonly FormatDefinition[];
  readonly recipes?: readonly Recipe[];
  readonly widgets?: WidgetRegistry;
};

const initOnly = (prop: 'formats' | 'recipes' | 'widgets'): InitOnly =>
  prop === 'formats' ? { formats: [] } : prop === 'recipes' ? { recipes: [] } : { widgets: {} };

@Component({
  imports: [SwManifestEditor],
  template: `
    <button type="button" class="undo" [disabled]="!history().canUndo" (click)="editor().controller()?.undo()">Undo</button>
    <button type="button" class="redo" [disabled]="!history().canRedo" (click)="editor().controller()?.redo()">Redo</button>
    <output class="active">{{ active() ?? '' }}</output>
    <sw-manifest-editor
      [codeEditor]="codeEditor"
      [(value)]="value"
      [(mode)]="mode"
      [format]="format()"
      [readOnly]="readOnly()"
      [theme]="theme()"
      [variables]="variables()"
      [guide]="guide()"
      [formats]="init().formats"
      [recipes]="init().recipes"
      [widgets]="init().widgets"
      (valueChange)="values.push($event)"
      (textChange)="changes.push($event)"
      (modeChange)="modes.push($event)"
      (activeFormatChange)="active.set($event); formats.push($event); seen.push(editor().controller())"
      (historyChange)="onHistory($event)"
      (problemsChange)="problems.push($event); seen.push(editor().controller())"
      (variablesChange)="decls.push($event)"
    />
  `,
})
class Host {
  readonly editor = viewChild.required(SwManifestEditor);
  readonly codeEditor = codeEditor;
  readonly value = signal('a: 1');
  readonly mode = signal<EditorMode>('split');
  readonly format = signal('auto');
  readonly readOnly = signal(false);
  readonly theme = signal<EditorTheme>('auto');
  readonly variables = signal<VariablesOption | undefined>(undefined);
  readonly guide = signal<ManifestEditorOptions['guide']>(undefined);
  readonly init = signal<InitOnly>({});
  readonly active = signal<string | undefined>(undefined);
  readonly history = signal<History>({ canUndo: false, canRedo: false });
  readonly values: string[] = [];
  readonly changes: { value: string; origin: ChangeOrigin }[] = [];
  readonly modes: EditorMode[] = [];
  readonly formats: (string | undefined)[] = [];
  readonly histories: History[] = [];
  readonly problems: (readonly Problem[])[] = [];
  readonly decls: (readonly VariableDecl[])[] = [];
  /** The controller `controller()` returned when each problems, format or history output ran. */
  readonly seen: (ManifestEditorController | undefined)[] = [];
  /** Makes the history listener throw. */
  historyThrows = false;

  onHistory(state: History): void {
    if (this.historyThrows) throw new Error('listener');
    this.history.set(state);
    this.histories.push(state);
    this.seen.push(this.editor().controller());
  }
}

/** Binds `value` one way and never listens to `valueChange`: the parent ignores the user's typing. */
@Component({
  imports: [SwManifestEditor],
  template: `<sw-manifest-editor [codeEditor]="codeEditor" [value]="'a: 1'" [theme]="theme()" />`,
})
class OneWayHost {
  readonly editor = viewChild.required(SwManifestEditor);
  readonly codeEditor = codeEditor;
  readonly theme = signal<EditorTheme>('light');
}

@Component({
  imports: [SwManifestEditor],
  template: `<sw-manifest-editor [codeEditor]="codeEditor" readOnly />`,
})
class StaticReadOnlyHost {
  readonly editor = viewChild.required(SwManifestEditor);
  readonly codeEditor = codeEditor;
}

async function create<T>(type: Type<T>): Promise<ComponentFixture<T>> {
  const fixture = TestBed.createComponent(type);
  await fixture.whenStable();
  return fixture;
}

/** Waits until the live editor is ready, then for Angular to settle. */
async function settle(f: ComponentFixture<{ editor(): SwManifestEditor }>): Promise<ManifestEditorController> {
  const ed = f.componentInstance.editor().controller()!;
  await ed.ready;
  await f.whenStable();
  return f.componentInstance.editor().controller()!;
}

/** Types into the newest mounted textarea (the live one: a recreated editor mounts later). */
async function type(f: ComponentFixture<unknown>, text: string): Promise<void> {
  adapter.instances.at(-1)!.type(text);
  await f.whenStable();
}

const q = <E extends Element>(f: ComponentFixture<unknown>, selector: string) =>
  (f.nativeElement as HTMLElement).querySelector<E>(selector);
const all = (f: ComponentFixture<unknown>, selector: string) => (f.nativeElement as HTMLElement).querySelectorAll(selector);

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  codeEditor = adapter = textareaAdapter();
});

afterEach(async () => {
  expect(errors).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await new Promise((r) => setTimeout(r, 0));
});

describe('sw-manifest-editor', () => {
  it('renders the editor for the initial value without detectChanges()', async () => {
    const f = TestBed.createComponent(Host);
    await vi.waitFor(() => {
      expect(q(f, 'sw-manifest-editor > .sw-editor')).not.toBeNull();
      expect(q<HTMLTextAreaElement>(f, 'textarea')?.value).toBe('a: 1');
    });
    expect(all(f, '.sw-editor')).toHaveLength(1);
    expect(getComputedStyle(q(f, 'sw-manifest-editor')!).display).toBe('block');
  });

  it('typing updates [(value)] without pushing it back', async () => {
    const f = await create(Host);
    const ed = await settle(f);
    const update = vi.spyOn(ed, 'update');
    await type(f, 'a: 2');
    expect(f.componentInstance.value()).toBe('a: 2');
    expect(f.componentInstance.values).toEqual(['a: 2']);
    expect(update).not.toHaveBeenCalled();
  });

  it("typing emits textChange with origin 'code'", async () => {
    const f = await create(Host);
    await settle(f);
    await type(f, 'a: 2');
    expect(f.componentInstance.changes).toEqual([{ value: 'a: 2', origin: 'code' }]);
    expect(Object.isFrozen(f.componentInstance.changes[0])).toBe(true);
  });

  it('a pushed value does not emit textChange', async () => {
    const f = await create(Host);
    await settle(f);
    f.componentInstance.value.set('b: 2');
    await f.whenStable();
    expect(f.componentInstance.changes).toEqual([]);
  });

  it("controller().setValue emits textChange with origin 'api'", async () => {
    const f = await create(Host);
    const ed = await settle(f);
    ed.setValue('b: 2');
    await f.whenStable();
    expect(f.componentInstance.changes).toEqual([{ value: 'b: 2', origin: 'api' }]);
  });

  it('controlled value: a changed value is pushed and does not echo valueChange', async () => {
    const f = await create(Host);
    const ed = await settle(f);
    f.componentInstance.value.set('b: 2');
    await f.whenStable();
    expect(ed.getValue()).toBe('b: 2');
    expect(q<HTMLTextAreaElement>(f, 'textarea')!.value).toBe('b: 2');
    expect(f.componentInstance.values).toEqual([]);
  });

  it('controlled value: a parent that ignores valueChange keeps the typed text across an unrelated change', async () => {
    const f = await create(OneWayHost);
    const ed = await settle(f);
    await type(f, 'a: 2');
    f.componentInstance.theme.set('dark');
    await f.whenStable();
    expect(ed.getValue()).toBe('a: 2');
    expect(q(f, '.sw-editor')!.getAttribute('data-sw-theme')).toBe('dark');
  });

  it('controller().setValue updates [(value)]', async () => {
    const f = await create(Host);
    const ed = await settle(f);
    ed.setValue('b: 2');
    await f.whenStable();
    expect(f.componentInstance.value()).toBe('b: 2');
    expect(f.componentInstance.values).toEqual(['b: 2']);
  });

  it('[(mode)]: a changed mode is pushed; the mode switch updates the parent', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    h.mode.set('visual');
    await f.whenStable();
    const ed = await settle(f);
    expect(ed.getMode()).toBe('visual');
    const set = vi.spyOn(h.editor().mode, 'set');
    h.mode.set('code');
    await f.whenStable();
    expect(ed.getMode()).toBe('code');
    // A pushed mode is not reported back.
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
    h.modes.length = 0;
    q<HTMLButtonElement>(f, '.sw-mode-radio[data-sw-mode="split"]')!.click();
    await f.whenStable();
    expect(h.modes).toEqual(['split']);
    expect(h.mode()).toBe('split');
    expect(ed.getMode()).toBe('split');
  });

  it('readOnly and theme inputs are pushed', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    h.theme.set('light');
    await f.whenStable();
    const ed = await settle(f);
    const root = q(f, '.sw-editor')!;
    expect(ed.getReadOnly()).toBe(false);
    expect(root.getAttribute('data-sw-theme')).toBe('light');
    h.readOnly.set(true);
    h.theme.set('dark');
    await f.whenStable();
    expect(ed.getReadOnly()).toBe(true);
    expect(root.getAttribute('data-sw-theme')).toBe('dark');
  });

  it('readOnly accepts a static attribute', async () => {
    const f = await create(StaticReadOnlyHost);
    const ed = await settle(f);
    expect(f.componentInstance.editor().readOnly()).toBe(true);
    expect(ed.getReadOnly()).toBe(true);
  });

  it("format='auto' keeps detecting while activeFormatChange reports compose then kubernetes", async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    h.value.set(COMPOSE);
    await f.whenStable();
    await settle(f);
    await vi.waitFor(() => expect(q(f, '.active')!.textContent).toBe('compose'));
    h.value.set(KUBERNETES);
    await f.whenStable();
    await vi.waitFor(() => expect(q(f, '.active')!.textContent).toBe('kubernetes'));
    expect(h.formats).toEqual(['compose', 'kubernetes']);
    expect(h.format()).toBe('auto');
    const ed = h.editor().controller()!;
    expect(ed.getFormat()).toBe('auto');
    expect(ed.getActiveFormat()).toBe('kubernetes');
  });

  it('a new guide object recreates the editor and keeps text, mode, format and readOnly', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    h.theme.set('dark');
    await f.whenStable();
    const old = await settle(f);
    const oldRoot = q(f, '.sw-editor')!;
    // An unrelated change does not recreate it.
    h.variables.set({ store: 'x-variables' });
    await f.whenStable();
    expect(h.editor().controller()).toBe(old);
    // State that only the editor holds: the inputs above say none of it (mode is two-way, so the host follows).
    await type(f, 'a: 2');
    old.setMode('code');
    old.setFormat('compose');
    old.setReadOnly(true);
    await f.whenStable();
    h.guide.set({});
    await f.whenStable();
    const next = h.editor().controller()!;
    expect(next).not.toBe(old);
    expect(oldRoot.isConnected).toBe(false);
    expect(all(f, '.sw-editor')).toHaveLength(1);
    expect(next.getValue()).toBe('a: 2');
    expect(next.getMode()).toBe('code');
    expect(next.getFormat()).toBe('compose');
    expect(next.getReadOnly()).toBe(true);
    expect(q(f, '.sw-editor')!.getAttribute('data-sw-theme')).toBe('dark');
    expect(h.value()).toBe('a: 2');
    await settle(f);
    expect(q<HTMLTextAreaElement>(f, 'textarea')!.value).toBe('a: 2');
    // The same guide again: nothing to recreate.
    h.guide.set(h.guide());
    await f.whenStable();
    expect(h.editor().controller()).toBe(next);
  });

  it.each(['formats', 'recipes', 'widgets'] as const)('a new %s reference recreates the editor and keeps the text', async (prop) => {
    const f = TestBed.createComponent(Host);
    const h = f.componentInstance;
    h.init.set(initOnly(prop));
    await f.whenStable();
    const old = await settle(f);
    await type(f, 'a: 2');
    h.init.set(initOnly(prop));
    await f.whenStable();
    expect(h.editor().controller()).not.toBe(old);
    expect(h.editor().controller()!.getValue()).toBe('a: 2');
    await settle(f);
  });

  it.each(['formats', 'recipes', 'widgets'] as const)('the same %s reference does not recreate the editor', async (prop) => {
    const stable = initOnly(prop);
    const f = TestBed.createComponent(Host);
    const h = f.componentInstance;
    h.init.set(stable);
    await f.whenStable();
    const old = await settle(f);
    h.init.set({ ...stable });
    await f.whenStable();
    expect(h.editor().controller()).toBe(old);
  });

  it('a new variables.value with the external store is pushed without recreation; a changed store kind recreates', async () => {
    const a: VariableDecl = { name: 'A', type: 'string' };
    const b: VariableDecl = { name: 'B', type: 'string' };
    const list = [a];
    const f = TestBed.createComponent(Host);
    const h = f.componentInstance;
    h.variables.set({ store: 'external', value: list });
    await f.whenStable();
    const first = await settle(f);
    const seen = first.getVariables();
    expect(seen.map((d) => d.name)).toEqual(['A']);
    // A new option object around the same list: nothing to push (a push would replace the frozen list).
    h.variables.set({ store: 'external', value: list });
    await f.whenStable();
    expect(h.editor().controller()).toBe(first);
    expect(first.getVariables()).toBe(seen);
    h.variables.set({ store: 'external', value: [a, b] });
    await f.whenStable();
    expect(h.editor().controller()).toBe(first);
    expect(first.getVariables().map((d) => d.name)).toEqual(['A', 'B']);
    // State that only the editor holds (value and mode are two-way, so the host follows).
    await type(f, 'a: 2');
    first.setMode('code');
    await f.whenStable();
    h.variables.set({ store: 'x-variables' });
    await f.whenStable();
    const second = h.editor().controller()!;
    expect(second).not.toBe(first);
    expect(second.getVariables()).toEqual([]);
    expect(second.getValue()).toBe('a: 2');
    expect(second.getMode()).toBe('code');
    // Undefined means the core default, the x-variables store.
    h.variables.set(undefined);
    await f.whenStable();
    expect(h.editor().controller()).toBe(second);
    await settle(f);
  });

  it('a variables.value push that throws is retried by the next push', async () => {
    const a: VariableDecl = { name: 'A', type: 'string' };
    const f = TestBed.createComponent(Host);
    const h = f.componentInstance;
    h.variables.set({ store: 'external', value: [a] });
    await f.whenStable();
    const ed = await settle(f);
    // One push: update() applies the variables before readOnly, and a duplicate name throws there.
    errors.mockImplementation(() => {}); // the error below is expected: keep the output clean
    h.readOnly.set(true);
    h.variables.set({ store: 'external', value: [a, a] });
    await expect(f.whenStable()).rejects.toThrow('duplicate variable');
    expect(errors).toHaveBeenCalledTimes(1); // Angular's ErrorHandler logs it
    errors.mockClear();
    expect(ed.getReadOnly()).toBe(false);
    // A corrected list: the next push carries it and the readOnly the failed one did not apply.
    h.variables.set({ store: 'external', value: [a] });
    await f.whenStable();
    expect(h.editor().controller()).toBe(ed);
    expect(ed.getVariables().map((d) => d.name)).toEqual(['A']);
    expect(ed.getReadOnly()).toBe(true);
  });

  it('historyChange drives undo buttons', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    await settle(f);
    const undo = q<HTMLButtonElement>(f, '.undo')!;
    const redo = q<HTMLButtonElement>(f, '.redo')!;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    await type(f, 'a: 2');
    expect(undo.disabled).toBe(false);
    undo.click();
    await f.whenStable();
    expect(h.editor().controller()!.getValue()).toBe('a: 1');
    expect(h.value()).toBe('a: 1');
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
    redo.click();
    await f.whenStable();
    expect(h.editor().controller()!.getValue()).toBe('a: 2');
    expect(redo.disabled).toBe(true);
  });

  it('recreation reports an empty history through historyChange', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    await settle(f);
    const undo = q<HTMLButtonElement>(f, '.undo')!;
    await type(f, 'a: 2');
    expect(undo.disabled).toBe(false);
    h.histories.length = 0;
    h.seen.length = 0;
    const old = h.editor().controller();
    h.guide.set({});
    await f.whenStable();
    const next = h.editor().controller()!;
    expect(next).not.toBe(old);
    // The listener already sees the new controller.
    expect(h.seen).toEqual([next]);
    expect(next.getValue()).toBe('a: 2');
    expect(next.canUndo()).toBe(false);
    expect(h.histories).toEqual([{ canUndo: false, canRedo: false }]);
    expect(Object.isFrozen(h.histories[0])).toBe(true);
    expect(undo.disabled).toBe(true);
    // Recreating again with an empty history has nothing new to report.
    h.histories.length = 0;
    h.guide.set({});
    await f.whenStable();
    expect(h.histories).toEqual([]);
    await settle(f);
  });

  it('recreation reports emptied problems and no active format', async () => {
    const f = TestBed.createComponent(Host);
    const h = f.componentInstance;
    h.value.set(INVALID_POD);
    await f.whenStable();
    await settle(f);
    await vi.waitFor(() => expect(h.formats).toEqual(['kubernetes']));
    expect(h.problems.at(-1)!.length).toBeGreaterThan(0);
    h.problems.length = 0;
    h.formats.length = 0;
    h.seen.length = 0;
    // The new editor gets empty text: it resolves no format and finds no problems, so it reports neither.
    h.guide.set({});
    h.value.set('');
    await f.whenStable();
    const next = h.editor().controller()!;
    await settle(f);
    expect(h.editor().controller()).toBe(next);
    expect(h.problems).toEqual([[]]);
    expect(Object.isFrozen(h.problems[0])).toBe(true);
    expect(h.problems[0]).toBe(next.getProblems()); // the list the controller holds, as the core reports it
    expect(h.formats).toEqual([undefined]);
    // Every listener (also historyChange, for the pushed text) already sees the new controller.
    expect(h.seen.length).toBeGreaterThanOrEqual(2);
    expect(h.seen.every((c) => c === next)).toBe(true);
    // Recreating again with nothing to empty reports nothing.
    h.problems.length = 0;
    h.formats.length = 0;
    h.guide.set({});
    await f.whenStable();
    await settle(f);
    expect(h.problems).toEqual([]);
    expect(h.formats).toEqual([]);
  });

  it('a throwing history listener at a recreation does not stop the new editor', async () => {
    const f = await create(Host);
    const h = f.componentInstance;
    await settle(f);
    await type(f, 'a: 2');
    errors.mockImplementation(() => {}); // the error below is expected: keep the output clean
    h.historyThrows = true;
    const old = h.editor().controller();
    h.guide.set({});
    await expect(f.whenStable()).rejects.toThrow('listener');
    expect(errors).toHaveBeenCalledTimes(1); // Angular's ErrorHandler logs it
    errors.mockClear();
    expect(h.editor().controller()).not.toBe(old);
    expect(h.editor().controller()!.getValue()).toBe('a: 2');
    await settle(f);
  });

  it('a recreation that throws leaves no controller', async () => {
    const dup: VariableDecl = { name: 'A', type: 'string' };
    const f = await create(Host);
    const h = f.componentInstance;
    await settle(f);
    await type(f, 'a: 2');
    errors.mockImplementation(() => {}); // the error below is expected: keep the output clean
    // A new store kind recreates the editor; invalid initial declarations make the core throw a TypeError.
    h.variables.set({ store: 'external', value: [dup, dup] });
    await expect(f.whenStable()).rejects.toThrow('duplicate variable');
    expect(errors).toHaveBeenCalledTimes(1); // Angular's ErrorHandler logs it
    errors.mockClear();
    expect(h.editor().controller()).toBeUndefined();
    expect(q(f, '.sw-editor')).toBeNull();
    // A corrected list (the same store kind) tries again, from the text the old editor had; an input changed with
    // it is pushed to the new editor.
    h.readOnly.set(true);
    h.variables.set({ store: 'external', value: [dup] });
    await f.whenStable();
    const next = await settle(f);
    expect(next.getValue()).toBe('a: 2');
    expect(next.getVariables().map((d) => d.name)).toEqual(['A']);
    expect(next.getReadOnly()).toBe(true);
    expect(all(f, '.sw-editor')).toHaveLength(1);
    // Another init-only change recreates it as usual.
    h.guide.set({});
    await f.whenStable();
    expect(h.editor().controller()).not.toBe(next);
    await settle(f);
  });

  it('a recreation that throws is reported once to the ErrorHandler', async () => {
    // As in an application: the ErrorHandler is told and the tick goes on (TestBed rethrows by default).
    const handleError = vi.fn();
    TestBed.configureTestingModule({
      rethrowApplicationErrors: false,
      providers: [{ provide: ErrorHandler, useValue: { handleError } }],
    });
    const dup: VariableDecl = { name: 'A', type: 'string' };
    const f = await create(Host);
    const h = f.componentInstance;
    await settle(f);
    h.variables.set({ store: 'external', value: [dup, dup] });
    await f.whenStable();
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(h.editor().controller()).toBeUndefined();
    h.variables.set({ store: 'external', value: [dup] });
    await f.whenStable();
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(h.editor().controller()!.getVariables().map((d) => d.name)).toEqual(['A']);
    await settle(f);
  });

  it('destroy before ready: no output after destroy, no unhandled rejection', async () => {
    // A code editor that never finishes mounting, so `ready` is still pending at the destroy.
    codeEditor = { mount: () => new Promise(() => {}) };
    const rejections = vi.fn();
    node.on('unhandledRejection', rejections);
    try {
      const f = TestBed.createComponent(Host);
      const h = f.componentInstance;
      h.value.set(KUBERNETES);
      f.detectChanges(); // creates the editor; destroyed below before its code editor starts mounting
      const cmp = h.editor();
      const ed = cmp.controller()!;
      f.destroy();
      expect(cmp.controller()).toBeUndefined();
      await ed.ready; // a destroyed editor's `ready` resolves
      await new Promise((r) => setTimeout(r, 300)); // past the validation debounce and the format load
      const outputs = [h.values, h.modes, h.formats, h.histories, h.problems, h.decls];
      expect(outputs.map((list) => list.length)).toEqual([0, 0, 0, 0, 0, 0]);
      expect(rejections).not.toHaveBeenCalled();
    } finally {
      node.off('unhandledRejection', rejections);
    }
  });

  it('the core runs outside the Angular zone', async () => {
    const spy = vi.spyOn(TestBed.inject(NgZone), 'runOutsideAngular');
    const f = await create(Host);
    await settle(f);
    // createManifestEditor itself is the body of one of the calls: that call returns the controller
    const returned = spy.mock.results.map((r) => r.value as { getValue?: unknown } | undefined);
    expect(returned.some((v) => typeof v?.getValue === 'function')).toBe(true);
  });
});
