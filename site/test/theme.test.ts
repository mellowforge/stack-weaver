import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { THEMES, THEME_KEY, textareaAdapter } from '@stack-weaver/demo-kit';
import { createThemeSwitch } from '../src/theme-switch.js';
import { mountVanillaDemo } from '../src/vanilla-demo.js';
import type { VanillaDemo } from '../src/vanilla-demo.js';

let errors: MockInstance<typeof console.error>;
let root: HTMLElement;
let demo: VanillaDemo | undefined;
let abort: AbortController;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  abort = new AbortController();
});
afterEach(() => {
  abort.abort();
  demo?.destroy();
  demo = undefined;
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

const radio = (label: string) =>
  [...root.querySelectorAll<HTMLElement>('[role="radio"]')].find((r) => r.textContent === label)!;
const keydown = (el: HTMLElement, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

describe('theme switch', () => {
  it('is an APG radio group with a roving tabindex, Auto first', () => {
    root.append(createThemeSwitch(abort.signal));
    const group = root.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-label')).toBe('Theme');
    expect([...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent)).toEqual(THEMES.map((t) => t.label));
    expect(radio('Auto').getAttribute('aria-checked')).toBe('true');
    expect(radio('Auto').tabIndex).toBe(0);
    expect(radio('Dark').getAttribute('aria-checked')).toBe('false');
    expect(radio('Dark').tabIndex).toBe(-1);
  });

  it('moves and selects with the arrow keys, Home and End', () => {
    root.append(createThemeSwitch(abort.signal));
    keydown(radio('Auto'), 'ArrowRight');
    expect(radio('Light').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('Light'));
    keydown(radio('Light'), 'End');
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');
    keydown(radio('Dark'), 'ArrowRight');
    expect(radio('Auto').getAttribute('aria-checked')).toBe('true');
    keydown(radio('Auto'), 'ArrowLeft');
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');
    keydown(radio('Dark'), 'Home');
    expect(radio('Auto').getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('starts from the stored theme', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    root.append(createThemeSwitch(abort.signal));
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');
  });

  it('choosing Dark stores it, sets data-theme and calls setTheme on the Vanilla editor', async () => {
    demo = mountVanillaDemo(root, { codeEditor: textareaAdapter() });
    const controller = demo.controller()!;
    await controller.ready;
    const setTheme = vi.spyOn(controller, 'setTheme');

    radio('Dark').click();
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');

    radio('Auto').click();
    expect(localStorage.getItem(THEME_KEY)).toBe('auto');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(setTheme).toHaveBeenLastCalledWith('auto');
  });

  it('a storage event from another frame applies the theme', async () => {
    demo = mountVanillaDemo(root, { codeEditor: textareaAdapter() });
    const controller = demo.controller()!;
    await controller.ready;
    const setTheme = vi.spyOn(controller, 'setTheme');

    localStorage.setItem(THEME_KEY, 'light'); // what the other frame wrote
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(setTheme).toHaveBeenCalledWith('light');
    expect(radio('Light').getAttribute('aria-checked')).toBe('true');

    setTheme.mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'x' }));
    expect(setTheme).not.toHaveBeenCalled();
  });
});
