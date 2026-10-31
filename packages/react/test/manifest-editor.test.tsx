import { Component, StrictMode, createRef, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { CodeEditorAdapter, Problem, VariableDecl, VariablesOption } from '@stack-weaver/core';
import { EXAMPLES, textareaAdapter } from '@stack-weaver/demo-kit';
import type { TextareaAdapter } from '@stack-weaver/demo-kit';
import { ManifestEditor } from '../src/index.js';
import type { ManifestEditorController, ManifestEditorProps } from '../src/index.js';

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

/** Shows the error a child threw while rendering or committing, in place of the child. */
class Boundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  override state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }
  override render(): ReactNode {
    return this.state.error === undefined ? this.props.children : <p data-testid="failed">{String(this.state.error)}</p>;
  }
}

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  adapter = textareaAdapter();
});

afterEach(() => {
  cleanup();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

/** Waits, inside act(), until the editor the ref points at is ready. */
async function settle(ref: RefObject<ManifestEditorController | null>): Promise<void> {
  await act(async () => {
    await ref.current!.ready;
  });
}

/** Types into the newest mounted textarea (the live one: a recreated or StrictMode editor mounts later). */
function type(text: string): void {
  act(() => adapter.instances.at(-1)!.type(text));
}

it('StrictMode: exactly one editor root and one textarea', async () => {
  const ref = createRef<ManifestEditorController>();
  const { container } = render(
    <StrictMode>
      <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" />
    </StrictMode>,
  );
  await settle(ref);
  expect(container.querySelectorAll('.sw-editor')).toHaveLength(1);
  expect(container.querySelectorAll('textarea')).toHaveLength(1);
  expect(container.querySelector('textarea')!.value).toBe('a: 1');
  expect(ref.current!.getValue()).toBe('a: 1');
});

describe.each([
  { name: 'ManifestEditor', strict: false },
  { name: 'ManifestEditor under StrictMode', strict: true },
])('$name', ({ strict }) => {
  const opts = { reactStrictMode: strict };

  it('renders the editor for the initial value without act()', async () => {
    const { container } = render(<ManifestEditor codeEditor={adapter} value="a: 1" />, opts);
    await waitFor(() => {
      expect(container.querySelector('.sw-editor')).not.toBeNull();
      expect(container.querySelector('textarea')?.value).toBe('a: 1');
    });
  });

  it("typing calls onChange with origin 'code'", async () => {
    const ref = createRef<ManifestEditorController>();
    const onChange = vi.fn();
    render(<ManifestEditor ref={ref} codeEditor={adapter} defaultValue="a: 1" onChange={onChange} />, opts);
    await settle(ref);
    type('a: 2');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('a: 2', { origin: 'code' });
  });

  it('controlled value: a changed prop is pushed and does not echo onChange', async () => {
    const ref = createRef<ManifestEditorController>();
    const onChange = vi.fn();
    const view = (value: string) => <ManifestEditor ref={ref} codeEditor={adapter} value={value} onChange={onChange} />;
    const { rerender, container } = render(view('a: 1'), opts);
    await settle(ref);
    rerender(view('b: 2'));
    expect(ref.current!.getValue()).toBe('b: 2');
    expect(container.querySelector('textarea')!.value).toBe('b: 2');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('controlled value: a parent that ignores onChange keeps the typed text across an unrelated re-render', async () => {
    const ref = createRef<ManifestEditorController>();
    const view = (label: string) => <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" aria-label={label} />;
    const { rerender } = render(view('one'), opts);
    await settle(ref);
    type('a: 2');
    rerender(view('two'));
    expect(ref.current!.getValue()).toBe('a: 2');
  });

  it('defaultValue is used once', async () => {
    const ref = createRef<ManifestEditorController>();
    const onChange = vi.fn();
    const view = (value: string) => <ManifestEditor ref={ref} codeEditor={adapter} defaultValue={value} onChange={onChange} />;
    const { rerender } = render(view('a: 1'), opts);
    await settle(ref);
    expect(ref.current!.getValue()).toBe('a: 1');
    rerender(view('b: 2'));
    expect(ref.current!.getValue()).toBe('a: 1');
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ref.current.setValue echoes onChange with origin 'api'", async () => {
    const ref = createRef<ManifestEditorController>();
    const onChange = vi.fn();
    render(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" onChange={onChange} />, opts);
    await settle(ref);
    act(() => ref.current!.setValue('b: 2'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('b: 2', { origin: 'api' });
  });

  it('mode prop and onModeChange', async () => {
    const ref = createRef<ManifestEditorController>();
    const onModeChange = vi.fn();
    const view = (mode: 'visual' | 'split' | 'code') => (
      <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" mode={mode} onModeChange={onModeChange} />
    );
    const { rerender, container } = render(view('visual'), opts);
    await settle(ref);
    expect(ref.current!.getMode()).toBe('visual');
    rerender(view('code'));
    expect(ref.current!.getMode()).toBe('code');
    // A pushed mode is not reported back.
    expect(onModeChange).not.toHaveBeenCalled();
    // The user picks Split; this parent ignores onModeChange, so its prop stays 'code'.
    fireEvent.click(container.querySelector('.sw-mode-radio[data-sw-mode="split"]')!);
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('split');
    // An unchanged prop is not pushed back over the user's choice.
    rerender(view('code'));
    expect(ref.current!.getMode()).toBe('split');
  });

  it('readOnly and theme props are pushed', async () => {
    const ref = createRef<ManifestEditorController>();
    const view = (readOnly: boolean, theme: 'light' | 'dark') => (
      <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" readOnly={readOnly} theme={theme} />
    );
    const { rerender, container } = render(view(false, 'light'), opts);
    await settle(ref);
    const root = container.querySelector('.sw-editor')!;
    expect(ref.current!.getReadOnly()).toBe(false);
    expect(root.getAttribute('data-sw-theme')).toBe('light');
    rerender(view(true, 'dark'));
    expect(ref.current!.getReadOnly()).toBe(true);
    expect(root.getAttribute('data-sw-theme')).toBe('dark');
  });

  it("format='auto' keeps detecting while onFormatChange reports compose then kubernetes", async () => {
    const ref = createRef<ManifestEditorController>();
    const reported: (string | undefined)[] = [];
    function Host({ value }: { value: string }) {
      const [active, setActive] = useState<string | undefined>();
      return (
        <>
          <output data-testid="active">{active ?? ''}</output>
          <ManifestEditor
            ref={ref}
            codeEditor={adapter}
            format="auto"
            value={value}
            onFormatChange={(f) => {
              reported.push(f);
              setActive(f);
            }}
          />
        </>
      );
    }
    const { rerender, getByTestId } = render(<Host value={COMPOSE} />, opts);
    await waitFor(() => expect(getByTestId('active').textContent).toBe('compose'));
    await settle(ref);
    rerender(<Host value={KUBERNETES} />);
    await waitFor(() => expect(getByTestId('active').textContent).toBe('kubernetes'));
    expect(reported).toEqual(['compose', 'kubernetes']);
    expect(ref.current!.getFormat()).toBe('auto');
    expect(ref.current!.getActiveFormat()).toBe('kubernetes');
  });

  it('inline callbacks: no recreation; the newest callback wins', async () => {
    const ref = createRef<ManifestEditorController>();
    const calls: number[] = [];
    const view = (n: number) => <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" onChange={() => calls.push(n)} />;
    const { rerender, container } = render(view(0), opts);
    await settle(ref);
    const first = ref.current;
    const root = container.querySelector('.sw-editor');
    for (let n = 1; n <= 5; n++) rerender(view(n));
    type('a: 2');
    expect(calls).toEqual([5]);
    expect(ref.current).toBe(first);
    expect(container.querySelector('.sw-editor')).toBe(root);
  });

  it('a new guide object recreates the editor and keeps text, mode, format and readOnly', async () => {
    const ref = createRef<ManifestEditorController>();
    // An inline guide: a new object on every render.
    const view = () => <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" theme="dark" guide={{}} />;
    const { rerender, container } = render(view(), opts);
    await settle(ref);
    const old = ref.current!;
    const oldRoot = container.querySelector('.sw-editor')!;
    // State that only the editor holds: the props above say none of it.
    type('a: 2');
    act(() => {
      old.setMode('code');
      old.setFormat('compose');
      old.setReadOnly(true);
    });
    rerender(view());
    const next = ref.current!;
    expect(next).not.toBe(old);
    expect(oldRoot.isConnected).toBe(false);
    expect(container.querySelectorAll('.sw-editor')).toHaveLength(1);
    expect(next.getValue()).toBe('a: 2');
    expect(next.getMode()).toBe('code');
    expect(next.getFormat()).toBe('compose');
    expect(next.getReadOnly()).toBe(true);
    expect(container.querySelector('.sw-editor')!.getAttribute('data-sw-theme')).toBe('dark');
    await settle(ref);
    expect(container.querySelector('textarea')!.value).toBe('a: 2');
  });

  const initOnly = (prop: 'formats' | 'recipes' | 'widgets'): Partial<ManifestEditorProps> =>
    prop === 'formats' ? { formats: [] } : prop === 'recipes' ? { recipes: [] } : { widgets: {} };

  it.each(['formats', 'recipes', 'widgets'] as const)('a new %s reference recreates the editor and keeps the text', async (prop) => {
    const ref = createRef<ManifestEditorController>();
    const view = (extra: Partial<ManifestEditorProps>) => <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" {...extra} />;
    const { rerender } = render(view(initOnly(prop)), opts);
    await settle(ref);
    const old = ref.current!;
    type('a: 2');
    rerender(view(initOnly(prop)));
    expect(ref.current).not.toBe(old);
    expect(ref.current!.getValue()).toBe('a: 2');
    await settle(ref);
  });

  it.each(['formats', 'recipes', 'widgets'] as const)('the same %s reference does not recreate the editor', async (prop) => {
    const ref = createRef<ManifestEditorController>();
    const stable = initOnly(prop);
    const view = (label: string) => <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" aria-label={label} {...stable} />;
    const { rerender } = render(view('one'), opts);
    await settle(ref);
    const old = ref.current;
    rerender(view('two'));
    expect(ref.current).toBe(old);
  });

  it('a new variables.value with the external store is pushed without recreation; a changed store kind recreates', async () => {
    const ref = createRef<ManifestEditorController>();
    const a: VariableDecl = { name: 'A', type: 'string' };
    const b: VariableDecl = { name: 'B', type: 'string' };
    const list = [a];
    const { rerender } = render(
      <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'external', value: list }} />,
      opts,
    );
    await settle(ref);
    const first = ref.current!;
    const seen = first.getVariables();
    expect(seen.map((d) => d.name)).toEqual(['A']);
    // A new option object around the same list: nothing to push (a push would replace the frozen list).
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'external', value: list }} />);
    expect(ref.current).toBe(first);
    expect(first.getVariables()).toBe(seen);
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'external', value: [a, b] }} />);
    expect(ref.current).toBe(first);
    expect(first.getVariables().map((d) => d.name)).toEqual(['A', 'B']);
    // State that only the editor holds: the props say none of it.
    type('a: 2');
    act(() => first.setMode('code'));
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'x-variables' }} />);
    const second = ref.current!;
    expect(second).not.toBe(first);
    expect(second.getVariables()).toEqual([]);
    expect(second.getValue()).toBe('a: 2');
    expect(second.getMode()).toBe('code');
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'x-variables' }} />);
    expect(ref.current).toBe(second);
    // No `variables` is the x-variables store (the core default): switching between the two is not a new kind.
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" />);
    expect(ref.current).toBe(second);
    rerender(<ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={{ store: 'x-variables' }} />);
    expect(ref.current).toBe(second);
    await settle(ref);
  });

  it('onHistoryChange drives undo buttons', async () => {
    let editor: RefObject<ManifestEditorController | null> | undefined;
    function Host() {
      const ref = useRef<ManifestEditorController>(null);
      editor = ref;
      const [history, setHistory] = useState({ canUndo: false, canRedo: false });
      return (
        <>
          <button type="button" data-testid="undo" disabled={!history.canUndo} onClick={() => ref.current?.undo()}>
            Undo
          </button>
          <button type="button" data-testid="redo" disabled={!history.canRedo} onClick={() => ref.current?.redo()}>
            Redo
          </button>
          <ManifestEditor ref={ref} codeEditor={adapter} defaultValue="a: 1" onHistoryChange={setHistory} />
        </>
      );
    }
    const { getByTestId } = render(<Host />, opts);
    await settle(editor!);
    const undo = getByTestId('undo') as HTMLButtonElement;
    const redo = getByTestId('redo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(true);
    type('a: 2');
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(editor!.current!.getValue()).toBe('a: 1');
    expect(undo.disabled).toBe(true);
    expect(redo.disabled).toBe(false);
    fireEvent.click(redo);
    expect(editor!.current!.getValue()).toBe('a: 2');
    expect(redo.disabled).toBe(true);
  });

  it('recreation reports an empty history through onHistoryChange', async () => {
    let editor: RefObject<ManifestEditorController | null> | undefined;
    const reported: { canUndo: boolean; canRedo: boolean }[] = [];
    /** The controller the ref held when each callback ran. */
    const seen: (ManifestEditorController | null)[] = [];
    // The guide is the parent's: each new object recreates the editor, which drops the undo history.
    function Host({ guide }: { guide: Record<string, never> }) {
      const ref = useRef<ManifestEditorController>(null);
      editor = ref;
      const [history, setHistory] = useState({ canUndo: false, canRedo: false });
      return (
        <>
          <button type="button" data-testid="undo" disabled={!history.canUndo} onClick={() => ref.current?.undo()}>
            Undo
          </button>
          <ManifestEditor
            ref={ref}
            codeEditor={adapter}
            defaultValue="a: 1"
            guide={guide}
            onHistoryChange={(state) => {
              reported.push(state);
              seen.push(ref.current);
              setHistory(state);
            }}
          />
        </>
      );
    }
    const { getByTestId, rerender } = render(<Host guide={{}} />, opts);
    await settle(editor!);
    const undo = getByTestId('undo') as HTMLButtonElement;
    type('a: 2');
    expect(undo.disabled).toBe(false);
    reported.length = 0;
    seen.length = 0;
    const old = editor!.current;
    rerender(<Host guide={{}} />);
    expect(editor!.current).not.toBe(old);
    // The callback already sees the new controller through the ref.
    expect(seen).toEqual([editor!.current]);
    expect(editor!.current!.getValue()).toBe('a: 2');
    expect(editor!.current!.canUndo()).toBe(false);
    expect(reported).toEqual([{ canUndo: false, canRedo: false }]);
    expect(Object.isFrozen(reported[0])).toBe(true);
    expect(undo.disabled).toBe(true);
    // Recreating again with an empty history has nothing new to report.
    reported.length = 0;
    rerender(<Host guide={{}} />);
    expect(reported).toEqual([]);
    await settle(editor!);
  });

  it('recreation reports emptied problems and no active format', async () => {
    const ref = createRef<ManifestEditorController>();
    const problems: (readonly Problem[])[] = [];
    const formats: (string | undefined)[] = [];
    /** The controller the ref held when each callback ran. */
    const seen: (ManifestEditorController | null)[] = [];
    // An inline guide: every render recreates the editor.
    const view = (value: string) => (
      <ManifestEditor
        ref={ref}
        codeEditor={adapter}
        value={value}
        guide={{}}
        onProblemsChange={(list) => {
          problems.push(list);
          seen.push(ref.current);
        }}
        onFormatChange={(f) => {
          formats.push(f);
          seen.push(ref.current);
        }}
      />
    );
    const { rerender } = render(view(INVALID_POD), opts);
    await settle(ref);
    expect(formats).toEqual(['kubernetes']);
    expect(problems.at(-1)!.length).toBeGreaterThan(0);
    problems.length = 0;
    formats.length = 0;
    seen.length = 0;
    // The new editor gets empty text: it resolves no format and finds no problems, so it reports neither.
    rerender(view(''));
    const next = ref.current!;
    await settle(ref);
    expect(ref.current).toBe(next);
    expect(problems).toEqual([[]]);
    expect(Object.isFrozen(problems[0])).toBe(true);
    expect(formats).toEqual([undefined]);
    expect(seen).toEqual([next, next]);
    // Recreating again with nothing to empty reports nothing.
    problems.length = 0;
    formats.length = 0;
    rerender(view(''));
    await settle(ref);
    expect(problems).toEqual([]);
    expect(formats).toEqual([]);
  });

  it('a throwing history listener at a recreation does not stop the new editor', async () => {
    const ref = createRef<ManifestEditorController>();
    const view = () => (
      <ManifestEditor
        ref={ref}
        codeEditor={adapter}
        value="a: 1"
        guide={{}}
        onHistoryChange={() => {
          throw new Error('listener');
        }}
      />
    );
    const { rerender } = render(view(), opts);
    await settle(ref);
    errors.mockImplementation(() => {}); // the error below is expected: keep the output clean
    type('a: 2'); // the core logs this throw
    errors.mockClear();
    const old = ref.current;
    rerender(view());
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith('stack-weaver: an onHistoryChange callback threw', expect.any(Error));
    errors.mockClear();
    expect(ref.current).not.toBe(old);
    expect(ref.current!.getValue()).toBe('a: 2');
    await settle(ref);
  });

  it('a recreation that throws leaves no controller', async () => {
    const ref = createRef<ManifestEditorController>();
    const dup: VariableDecl = { name: 'A', type: 'string' };
    const view = (variables?: VariablesOption) => (
      <Boundary>
        <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" variables={variables} />
      </Boundary>
    );
    const { rerender, container, getByTestId } = render(view(), opts);
    await settle(ref);
    errors.mockImplementation(() => {}); // the error below is expected: keep the output clean
    // A new store kind recreates the editor; invalid initial declarations make the core throw a TypeError.
    rerender(view({ store: 'external', value: [dup, dup] }));
    expect(getByTestId('failed').textContent).toContain('duplicate variable');
    expect(ref.current).toBeNull();
    expect(container.querySelector('.sw-editor')).toBeNull();
    expect(errors).toHaveBeenCalled(); // React reports the error its boundary caught
    errors.mockClear();
  });

  it('unmount before ready: no callback after unmount, no unhandled rejection', async () => {
    const ref = createRef<ManifestEditorController>();
    // A code editor that never finishes mounting, so `ready` is still pending at the unmount.
    const never: CodeEditorAdapter = { mount: () => new Promise(() => {}) };
    const callbacks = {
      onChange: vi.fn(),
      onModeChange: vi.fn(),
      onFormatChange: vi.fn(),
      onProblemsChange: vi.fn(),
      onHistoryChange: vi.fn(),
      onVariablesChange: vi.fn(),
    };
    const rejections = vi.fn();
    node.on('unhandledRejection', rejections);
    try {
      const { unmount } = render(<ManifestEditor ref={ref} codeEditor={never} value={KUBERNETES} {...callbacks} />, opts);
      const editor = ref.current!;
      unmount();
      expect(ref.current).toBeNull();
      await editor.ready; // a destroyed editor's `ready` resolves
      await new Promise((r) => setTimeout(r, 300)); // past the validation debounce and the format load
      for (const [name, fn] of Object.entries(callbacks)) expect(fn, name).not.toHaveBeenCalled();
      expect(rejections).not.toHaveBeenCalled();
    } finally {
      node.off('unhandledRejection', rejections);
    }
  });

  it('className and style on the host div survive re-renders', async () => {
    const ref = createRef<ManifestEditorController>();
    const view = (label: string) => (
      <ManifestEditor ref={ref} codeEditor={adapter} value="a: 1" className="host" style={{ height: '300px' }} aria-label={label} />
    );
    const { rerender, container } = render(view('one'), opts);
    await settle(ref);
    rerender(view('two'));
    const host = container.firstElementChild as HTMLElement;
    expect(host.tagName).toBe('DIV');
    expect(host.className).toBe('host');
    expect(host.style.height).toBe('300px');
    expect(host.getAttribute('aria-label')).toBe('two');
    expect(host.querySelectorAll(':scope > .sw-editor')).toHaveLength(1);
  });
});
