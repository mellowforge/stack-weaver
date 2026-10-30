// Shared contract suite (not a test file): run it from each adapter's test file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodeDiagnostic, CodeEditorAdapter, CodeEditorInit, CodeEditorInstance } from '../../src/editors/adapter.js';

/** A mounted editor plus the element it lives in. */
export interface Mounted {
  readonly el: HTMLElement;
  readonly inst: CodeEditorInstance;
}

/** Adapter-specific ways to act like a user and to look inside the editor. */
export interface ContractHarness {
  readonly adapter: CodeEditorAdapter;
  /** Simulates the user typing `s` at the end of the text (calls `onChange`). */
  type(m: Mounted, s: string): void;
  /** Places the caret without going through `applyChange`. */
  setCaret(m: Mounted, offset: number): void;
  /** The element that receives key presses (the focused editing surface). */
  keyTarget(m: Mounted): HTMLElement;
  /** The diagnostics currently shown. */
  diagnostics(m: Mounted): CodeDiagnostic[];
  /** Asks for completions at the caret and resolves to the labels offered. */
  completions(m: Mounted): Promise<string[]>;
  /** The accessible name of the editing surface. */
  ariaLabel(m: Mounted): string | null;
}

const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform);
/** Dispatches a platform "Mod" key press (Ctrl, or Meta on Apple platforms) on the editing surface. */
function pressMod(target: HTMLElement, key: string, shiftKey = false): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: shiftKey ? key.toUpperCase() : key,
      keyCode: key.toUpperCase().charCodeAt(0), // happy-dom sets none; CodeMirror needs it for Shift+letter
      shiftKey,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    }),
  );
}

export function runAdapterContract(name: string, makeHarness: () => ContractHarness): void {
  describe(`CodeEditorAdapter contract: ${name}`, () => {
    let h: ContractHarness;
    let el: HTMLElement;
    let live: Mounted[];

    const base = (text: string, over: Partial<CodeEditorInit> = {}) => ({
      text,
      readOnly: false,
      theme: 'light' as const,
      ariaLabel: 'YAML code',
      onChange: vi.fn<(t: string) => void>(),
      onUndo: vi.fn<() => void>(),
      onRedo: vi.fn<() => void>(),
      ...over,
    });
    const mount = (init: ReturnType<typeof base>): Mounted => {
      const m = { el, inst: h.adapter.mount(el, init) };
      live.push(m);
      return m;
    };

    beforeEach(() => {
      h = makeHarness();
      el = document.createElement('div');
      document.body.appendChild(el);
      live = [];
    });
    afterEach(() => {
      for (const m of live) m.inst.destroy();
      el.remove();
    });

    it('mount shows initial text', () => {
      const m = mount(base('a: 1\n'));
      expect(m.inst.getText()).toBe('a: 1\n');
    });

    it('user typing calls onChange with the full text', () => {
      const init = base('a: 1');
      const m = mount(init);
      h.type(m, '0');
      expect(init.onChange).toHaveBeenCalledTimes(1);
      expect(init.onChange).toHaveBeenCalledWith('a: 10');
      expect(m.inst.getText()).toBe('a: 10');
    });

    it('applyChange does not call onChange', () => {
      const init = base('a: 1');
      const m = mount(init);
      m.inst.applyChange({ from: 3, to: 4, insert: '22' });
      expect(m.inst.getText()).toBe('a: 22');
      expect(init.onChange).not.toHaveBeenCalled();
    });

    it('applyChange keeps a selection outside the change', () => {
      const init = base('x'.repeat(60));
      const m = mount(init);
      h.setCaret(m, 40);
      m.inst.applyChange({ from: 5, to: 5, insert: 'abc' });
      expect(m.inst.getSelection()).toEqual({ from: 43, to: 43 });
      expect(init.onChange).not.toHaveBeenCalled();
    });

    it('onSelectionChange reports the new selection', () => {
      const onSelectionChange = vi.fn();
      const m = mount(base('hello world', { onSelectionChange }));
      h.setCaret(m, 4);
      expect(onSelectionChange).toHaveBeenLastCalledWith({ from: 4, to: 4 });
    });

    it('setDiagnostics replaces diagnostics', () => {
      const m = mount(base('a: 1\nb: 2\n'));
      m.inst.setDiagnostics([{ from: 0, to: 1, severity: 'error', message: 'one' }]);
      expect(h.diagnostics(m)).toEqual([{ from: 0, to: 1, severity: 'error', message: 'one' }]);
      m.inst.setDiagnostics([
        { from: 5, to: 6, severity: 'warning', message: 'two' },
        { from: 7, to: 8, severity: 'info', message: 'three' },
      ]);
      expect(h.diagnostics(m).map((d) => [d.severity, d.message])).toEqual([
        ['warning', 'two'],
        ['info', 'three'],
      ]);
      m.inst.setDiagnostics([]);
      expect(h.diagnostics(m)).toEqual([]);
    });

    it('reveal with select sets the selection', () => {
      const m = mount(base('one\ntwo\nthree\n'));
      m.inst.reveal({ from: 4, to: 7 }, { select: true });
      expect(m.inst.getSelection()).toEqual({ from: 4, to: 7 });
    });

    it('reveal without select leaves the selection alone', () => {
      const m = mount(base('one\ntwo\nthree\n'));
      h.setCaret(m, 2);
      m.inst.reveal({ from: 4, to: 7 });
      expect(m.inst.getSelection()).toEqual({ from: 2, to: 2 });
    });

    it('setReadOnly blocks typing', () => {
      const init = base('a');
      const m = mount(init);
      m.inst.setReadOnly(true);
      h.type(m, 'b');
      expect(m.inst.getText()).toBe('a');
      expect(init.onChange).not.toHaveBeenCalled();
      m.inst.setReadOnly(false);
      h.type(m, 'b');
      expect(m.inst.getText()).toBe('ab');
    });

    it('readOnly at mount blocks typing', () => {
      const m = mount(base('a', { readOnly: true }));
      h.type(m, 'b');
      expect(m.inst.getText()).toBe('a');
    });

    it('Mod-z calls onUndo and does not change text', () => {
      const init = base('a: 1');
      const m = mount(init);
      h.type(m, '2');
      pressMod(h.keyTarget(m), 'z');
      expect(init.onUndo).toHaveBeenCalledTimes(1);
      expect(init.onRedo).not.toHaveBeenCalled();
      expect(m.inst.getText()).toBe('a: 12');
    });

    it('Mod-Shift-z calls onRedo and does not change text', () => {
      const init = base('a: 1');
      const m = mount(init);
      pressMod(h.keyTarget(m), 'z', true);
      expect(init.onRedo).toHaveBeenCalledTimes(1);
      expect(init.onUndo).not.toHaveBeenCalled();
      expect(m.inst.getText()).toBe('a: 1');
    });

    it('Mod-y calls onRedo and does not change text', () => {
      const init = base('a: 1');
      const m = mount(init);
      pressMod(h.keyTarget(m), 'y');
      expect(init.onRedo).toHaveBeenCalledTimes(1);
      expect(init.onUndo).not.toHaveBeenCalled();
      expect(m.inst.getText()).toBe('a: 1');
    });

    it('applyChange does not call onSelectionChange', () => {
      const onSelectionChange = vi.fn();
      const m = mount(base('x'.repeat(60), { onSelectionChange }));
      h.setCaret(m, 40);
      onSelectionChange.mockClear();
      m.inst.applyChange({ from: 5, to: 5, insert: 'abc' });
      expect(onSelectionChange).not.toHaveBeenCalled();
    });

    it('a caret at the start of an external insert stays before the inserted text', () => {
      const m = mount(base('x'.repeat(20)));
      h.setCaret(m, 5);
      m.inst.applyChange({ from: 5, to: 5, insert: 'abc' });
      expect(m.inst.getSelection()).toEqual({ from: 5, to: 5 });
    });

    it('setDiagnostics clamps out-of-range diagnostics to the document', () => {
      const m = mount(base('abc'));
      m.inst.setDiagnostics([
        { from: 1, to: 999, severity: 'error', message: 'past end' },
        { from: -5, to: 2, severity: 'info', message: 'before start' },
      ]);
      expect(h.diagnostics(m).map((d) => [d.from, d.to, d.message]).sort()).toEqual([
        [0, 2, 'before start'],
        [1, 3, 'past end'],
      ]);
    });

    it('complete results are offered', async () => {
      const complete = vi.fn(() => ({
        from: 0,
        options: [{ label: 'apiVersion', apply: 'apiVersion: ', detail: 'required' }, { label: 'kind', apply: 'kind: ' }],
      }));
      const m = mount(base('', { complete }));
      const labels = await h.completions(m);
      expect(labels).toEqual(['apiVersion', 'kind']);
      expect(complete).toHaveBeenCalledWith('', 0, true);
    });

    it('sets the accessible name', () => {
      const m = mount(base('a', { ariaLabel: 'Manifest YAML' }));
      expect(h.ariaLabel(m)).toBe('Manifest YAML');
    });

    it('setTheme does not disturb text or throw', () => {
      const m = mount(base('a'));
      m.inst.setTheme('dark');
      m.inst.setTheme('light');
      expect(m.inst.getText()).toBe('a');
    });

    it('destroy removes DOM', () => {
      const m = mount(base('a'));
      expect(el.childElementCount).toBeGreaterThan(0);
      m.inst.destroy();
      expect(el.childElementCount).toBe(0);
    });

    it('applyChange while read-only changes the text and does not call onChange', () => {
      const init = base('a: 1\n');
      const m = mount(init);
      m.inst.setReadOnly(true);
      m.inst.applyChange({ from: 3, to: 4, insert: '2' });
      expect(m.inst.getText()).toBe('a: 2\n');
      expect(init.onChange).not.toHaveBeenCalled();
    });

    it('a caret inside a replaced range maps to the start of the change', () => {
      const m = mount(base('x'.repeat(20)));
      h.setCaret(m, 7);
      m.inst.applyChange({ from: 5, to: 10, insert: 'ab' });
      expect(m.inst.getSelection()).toEqual({ from: 5, to: 5 });
    });

    it('a caret at the end of a replaced range moves after the replacement', () => {
      const m = mount(base('x'.repeat(20)));
      h.setCaret(m, 10);
      m.inst.applyChange({ from: 5, to: 10, insert: 'ab' });
      expect(m.inst.getSelection()).toEqual({ from: 7, to: 7 });
    });

    it('a selection straddling a replaced range keeps its outside end', () => {
      const m = mount(base('x'.repeat(20)));
      m.inst.reveal({ from: 3, to: 7 }, { select: true });
      m.inst.applyChange({ from: 5, to: 10, insert: 'ab' });
      expect(m.inst.getSelection()).toEqual({ from: 3, to: 5 });
      m.inst.reveal({ from: 6, to: 12 }, { select: true });
      m.inst.applyChange({ from: 5, to: 8, insert: 'cd' });
      expect(m.inst.getSelection()).toEqual({ from: 7, to: 11 });
    });

    describe('CRLF text', () => {
      const CRLF = 'a: 1\r\nb: 2\r\n';

      it('getText round-trips CRLF byte for byte', () => {
        const m = mount(base(CRLF));
        expect(m.inst.getText()).toBe(CRLF);
      });

      it('typing keeps CRLF in the text passed to onChange', () => {
        const init = base(CRLF);
        const m = mount(init);
        h.type(m, 'c');
        expect(init.onChange).toHaveBeenLastCalledWith(`${CRLF}c`);
        expect(m.inst.getText()).toBe(`${CRLF}c`);
      });

      it('applyChange uses offsets into the CRLF text', () => {
        const init = base(CRLF);
        const m = mount(init);
        m.inst.applyChange({ from: 9, to: 10, insert: '3' });
        expect(m.inst.getText()).toBe('a: 1\r\nb: 3\r\n');
        m.inst.applyChange({ from: 12, to: 12, insert: 'c: 4\r\n' });
        expect(m.inst.getText()).toBe('a: 1\r\nb: 3\r\nc: 4\r\n');
        m.inst.applyChange({ from: 0, to: 6, insert: '' });
        expect(m.inst.getText()).toBe('b: 3\r\nc: 4\r\n');
        expect(init.onChange).not.toHaveBeenCalled();
      });

      it('applyChange that splits a CRLF pair still gives the spliced text', () => {
        const m = mount(base(CRLF));
        m.inst.applyChange({ from: 5, to: 5, insert: '\r\nx: 0\r' });
        expect(m.inst.getText()).toBe('a: 1\r\r\nx: 0\r\nb: 2\r\n');
      });

      it('an empty document becomes CRLF through applyChange, then typing keeps CRLF', () => {
        const init = base('');
        const m = mount(init);
        m.inst.applyChange({ from: 0, to: 0, insert: CRLF });
        expect(m.inst.getText()).toBe(CRLF);
        h.setCaret(m, 9);
        expect(m.inst.getSelection()).toEqual({ from: 9, to: 9 });
        h.type(m, 'c');
        expect(init.onChange).toHaveBeenLastCalledWith(`${CRLF}c`);
      });

      it('a CRLF document becomes LF through applyChange', () => {
        const m = mount(base(CRLF));
        m.inst.applyChange({ from: 0, to: CRLF.length, insert: 'a: 1\nb: 2\n' });
        expect(m.inst.getText()).toBe('a: 1\nb: 2\n');
      });

      it('diagnostics use CRLF offsets and are clamped to the text', () => {
        const m = mount(base(CRLF));
        m.inst.setDiagnostics([
          { from: 9, to: 10, severity: 'error', message: 'two' },
          { from: 6, to: 999, severity: 'warning', message: 'past end' },
        ]);
        expect(h.diagnostics(m).map((d) => [d.from, d.to, d.message]).sort()).toEqual([
          [6, 12, 'past end'],
          [9, 10, 'two'],
        ]);
      });

      it('selection offsets are CRLF offsets', () => {
        const onSelectionChange = vi.fn();
        const m = mount(base(CRLF, { onSelectionChange }));
        h.setCaret(m, 9);
        expect(m.inst.getSelection()).toEqual({ from: 9, to: 9 });
        expect(onSelectionChange).toHaveBeenLastCalledWith({ from: 9, to: 9 });
        m.inst.reveal({ from: 6, to: 10 }, { select: true });
        expect(m.inst.getSelection()).toEqual({ from: 6, to: 10 });
        h.setCaret(m, 9);
        m.inst.applyChange({ from: 0, to: 0, insert: 'x: 0\r\n' });
        expect(m.inst.getSelection()).toEqual({ from: 15, to: 15 });
      });

      it('complete receives the CRLF text and a CRLF offset', async () => {
        const complete = vi.fn(() => ({ from: 6, options: [{ label: 'beta', apply: 'beta' }] }));
        const m = mount(base('a: 1\r\nb', { complete }));
        h.setCaret(m, 7);
        expect(await h.completions(m)).toEqual(['beta']);
        expect(complete).toHaveBeenCalledWith('a: 1\r\nb', 7, true);
      });
    });
  });
}
