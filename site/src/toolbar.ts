import { EXAMPLES } from '@stack-weaver/demo-kit';
import { createThemeSwitch } from './theme-switch.js';

/** The demo toolbar: the example picker, the read-only box, Undo and Redo, and the theme switch. */
export interface Toolbar {
  readonly el: HTMLElement;
  /** Enables or disables Undo and Redo. */
  setHistory(state: { readonly canUndo: boolean; readonly canRedo: boolean }): void;
}

export interface ToolbarHandlers {
  onExample(id: string): void;
  onReadOnly(readOnly: boolean): void;
  onUndo(): void;
  onRedo(): void;
}

let instance = 0;

/** Builds the toolbar DOM. React and Angular render the same markup, so the three demos look and read alike. */
export function createToolbar(handlers: ToolbarHandlers, signal: AbortSignal): Toolbar {
  const uid = `demo-tb${++instance}`;
  const el = document.createElement('div');
  el.className = 'toolbar';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Demo controls');

  const pickerLabel = document.createElement('label');
  pickerLabel.htmlFor = `${uid}-example`;
  pickerLabel.textContent = 'Example';
  const picker = document.createElement('select');
  picker.id = `${uid}-example`;
  for (const ex of EXAMPLES) {
    const option = document.createElement('option');
    option.value = ex.id;
    option.textContent = ex.label;
    picker.append(option);
  }
  picker.addEventListener('change', () => handlers.onExample(picker.value), { signal });

  const readOnlyLabel = document.createElement('label');
  const readOnly = document.createElement('input');
  readOnly.type = 'checkbox';
  readOnly.addEventListener('change', () => handlers.onReadOnly(readOnly.checked), { signal });
  readOnlyLabel.append(readOnly, ' Read-only');

  const button = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'button';
    b.textContent = text;
    b.disabled = true;
    b.addEventListener('click', onClick, { signal });
    return b;
  };
  const undo = button('Undo', handlers.onUndo);
  const redo = button('Redo', handlers.onRedo);

  el.append(pickerLabel, picker, readOnlyLabel, undo, redo, createThemeSwitch(signal));
  return {
    el,
    setHistory(state) {
      undo.disabled = !state.canUndo;
      redo.disabled = !state.canRedo;
    },
  };
}
