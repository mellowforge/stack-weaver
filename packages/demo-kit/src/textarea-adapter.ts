import type { CodeDiagnostic, CodeEditorInit, CodeEditorInstance, SyncCodeEditorAdapter, TextChange, TextRange } from '@mellowforge/stack-weaver-core';

/** A mounted textarea editor, with the extras the demos and tests read. */
export interface TextareaInstance extends CodeEditorInstance {
  /** Diagnostics last set. */
  readonly diagnostics: readonly CodeDiagnostic[];
  /** Simulates user input: sets the textarea value and fires `input`. A read-only textarea refuses it. */
  type(text: string): void;
}

/** A synchronous adapter over a plain `<textarea>`; `instances` lists everything it mounted. */
export type TextareaAdapter = SyncCodeEditorAdapter & {
  readonly instances: readonly TextareaInstance[];
  mount(el: HTMLElement, init: CodeEditorInit): TextareaInstance;
};

// As CodeMirror maps positions: inside a replaced range `assoc < 0` gives its start and
// `assoc >= 0` its end; at an insertion point `assoc < 0` stays before the inserted text.
function mapPos(pos: number, c: TextChange, assoc: number): number {
  if (pos < c.from) return pos;
  if (pos > c.to || (pos === c.to && c.to > c.from)) return pos + c.insert.length - (c.to - c.from);
  if (pos === c.from && c.to > c.from) return c.from;
  return assoc < 0 ? c.from : c.from + c.insert.length;
}

function mapSelection(s: TextRange, c: TextChange): TextRange {
  if (s.from === s.to) {
    const p = mapPos(s.from, c, -1);
    return { from: p, to: p };
  }
  return { from: mapPos(s.from, c, 1), to: mapPos(s.to, c, -1) };
}

/**
 * A dependency-free code editor for the demos' tests: a labelled `<textarea class="demo-code">`.
 * It stands in for CodeMirror where only the editor contract matters.
 */
export function textareaAdapter(): TextareaAdapter {
  const instances: TextareaInstance[] = [];
  return {
    instances,
    mount(el, init) {
      const doc = el.ownerDocument;
      const area = doc.createElement('textarea');
      area.className = 'demo-code';
      area.setAttribute('aria-label', init.ariaLabel);
      area.spellcheck = false;
      el.appendChild(area);
      let text = init.text;
      let selection: TextRange = { from: 0, to: 0 };
      let diagnostics: readonly CodeDiagnostic[] = [];
      let readOnly = init.readOnly;
      let destroyed = false;
      /** The exact text `type` asked for: a textarea may normalize line breaks in `value`. */
      let typed: string | undefined;
      const isMac = /Mac|iP(hone|ad|od)/.test(doc.defaultView?.navigator.platform ?? '');
      const render = (): void => {
        area.value = text;
        area.readOnly = readOnly;
      };
      render();

      area.addEventListener('input', () => {
        const next = typed ?? area.value;
        typed = undefined;
        if (readOnly || destroyed) {
          area.value = text;
          return;
        }
        text = next;
        selection = { from: text.length, to: text.length };
        init.onChange(text);
      });
      area.addEventListener('keydown', (e) => {
        if (!(isMac ? e.metaKey : e.ctrlKey)) return;
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) init.onUndo();
        else if ((key === 'z' && e.shiftKey) || key === 'y') init.onRedo();
        else return;
        e.preventDefault();
      });

      const instance: TextareaInstance = {
        getText: () => text,
        applyChange(c) {
          text = text.slice(0, c.from) + c.insert + text.slice(c.to);
          selection = mapSelection(selection, c);
          render();
        },
        setDiagnostics(d) {
          diagnostics = d.map((x) => {
            const from = Math.min(Math.max(x.from, 0), text.length);
            return { ...x, from, to: Math.min(Math.max(x.to, from), text.length) };
          });
        },
        reveal(range, opts) {
          if (opts?.select) selection = range;
        },
        getSelection: () => selection,
        setReadOnly(v) {
          readOnly = v;
          render();
        },
        setTheme(t) {
          area.dataset['theme'] = t;
        },
        focus: () => area.focus(),
        destroy() {
          if (destroyed) return;
          destroyed = true;
          area.remove();
        },
        get diagnostics() {
          return diagnostics;
        },
        type(next) {
          typed = next;
          area.value = next;
          area.dispatchEvent(new Event('input', { bubbles: true }));
        },
      };
      area.dataset['theme'] = init.theme;
      instances.push(instance);
      return instance;
    },
  };
}
