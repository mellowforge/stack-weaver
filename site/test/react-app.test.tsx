import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { EXAMPLES, THEME_KEY, textareaAdapter } from 'stack-weaver-demo-kit';
import type { TextareaAdapter } from 'stack-weaver-demo-kit';
import { App } from '../react/app.js';

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  adapter = textareaAdapter();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // no React warnings (act, keys, unknown props, double mounts, callback throws) in any test
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

const toolbar = () => within(screen.getByRole('group', { name: 'Demo controls' }));
const status = () => document.querySelector('.demo-status')!.textContent;
const undoButton = () => toolbar().getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
const redoButton = () => toolbar().getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
const type = (text: string) => act(() => adapter.instances.at(-1)!.type(text));
const choose = (id: string) => fireEvent.change(screen.getByLabelText('Example'), { target: { value: id } });

/** Renders the app and waits until its editor shows. */
async function mount() {
  const view = render(
    <StrictMode>
      <App codeEditor={adapter} />
    </StrictMode>,
  );
  await waitFor(() => expect(view.container.querySelector('textarea')).not.toBeNull());
  return view;
}

describe('React demo', () => {
  it('renders the editor and the toolbar without act()', async () => {
    const { container } = await mount();
    expect(container.querySelectorAll('.sw-editor')).toHaveLength(1);
    expect(container.querySelectorAll('textarea')).toHaveLength(1);
    // The wrapper's own host is the .demo-editor box (parity with the Vanilla demo).
    expect(container.querySelector('.sw-editor')!.parentElement!.classList.contains('demo-editor')).toBe(true);
    expect(screen.getByLabelText('Example')).toBeTruthy();
    expect(screen.getByLabelText('Read-only')).toBeTruthy();
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    expect([...screen.getByLabelText('Example').querySelectorAll('option')].map((o) => o.textContent)).toEqual(
      EXAMPLES.map((e) => e.label),
    );
    await waitFor(() => expect(status()).toContain('kubernetes'));
  });

  it.each([
    ['compose', 'compose'],
    ['compose-external', 'compose'],
    ['empty', 'no format yet'],
    ['kubernetes', 'kubernetes'],
  ])('choosing %s updates the status line', async (id, format) => {
    const { container } = await mount();
    if (id === 'kubernetes') choose('compose'); // leave the first example so the choice is a change
    choose(id);
    const example = EXAMPLES.find((e) => e.id === id)!;
    await waitFor(() => {
      expect(status()).toContain(format);
      expect(container.querySelector('textarea')!.value).toBe(example.value);
    });
    expect(container.querySelectorAll('.sw-editor')).toHaveLength(1);
  });

  // Both are recreations (a new variables store kind): the new editor starts with no format and no problems.
  it('choosing Empty after Compose with external variables clears the format', async () => {
    await mount();
    choose('compose-external');
    await waitFor(() => expect(status()).toContain('compose'));
    choose('empty');
    await waitFor(() => expect(status()).toContain('no format yet'));
  });

  it('choosing Compose with external variables after Broken clears the problems', async () => {
    await mount();
    choose('broken');
    await waitFor(() => expect(status()).toMatch(/\d+ problems?/));
    choose('compose-external');
    await waitFor(() => expect(status()).toContain('No problems'));
  });

  it('read-only blocks typing', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('Read-only'));
    const before = adapter.instances.at(-1)!.getText();
    type('kind: Pod');
    expect(adapter.instances.at(-1)!.getText()).toBe(before);
    fireEvent.click(screen.getByLabelText('Read-only'));
    type('kind: Pod');
    expect(adapter.instances.at(-1)!.getText()).toBe('kind: Pod');
  });

  it('Undo enables after typing and undoes', async () => {
    const { container } = await mount();
    const original = EXAMPLES[0]!.value;
    type('kind: Pod');
    await waitFor(() => expect(undoButton().disabled).toBe(false));
    expect(status()).toContain('last change: code');
    fireEvent.click(undoButton());
    await waitFor(() => expect(container.querySelector('textarea')!.value).toBe(original));
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('Broken shows the banner', async () => {
    const { container } = await mount();
    choose('broken');
    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('.sw-banner')!.hidden).toBe(false);
      expect(status()).toMatch(/\d+ problems?/);
    });
  });

  it('the theme switch stores the theme and sets data-theme', async () => {
    await mount();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(adapter.instances.at(-1)!.getText()).toBeDefined());
    act(() => {
      localStorage.setItem(THEME_KEY, 'light');
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_KEY, newValue: 'light' }));
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true');
  });
});
