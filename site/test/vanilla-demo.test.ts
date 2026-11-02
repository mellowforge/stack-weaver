import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { EXAMPLES, textareaAdapter } from 'stack-weaver-demo-kit';
import type { TextareaAdapter } from 'stack-weaver-demo-kit';
import { mountVanillaDemo } from '../src/vanilla-demo.js';
import type { VanillaDemo } from '../src/vanilla-demo.js';

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;
let root: HTMLElement;
let demo: VanillaDemo;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  adapter = textareaAdapter();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => {
  demo.destroy();
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
});

async function mount(): Promise<void> {
  demo = mountVanillaDemo(root, { codeEditor: adapter });
  await demo.controller()!.ready;
}

const status = () => root.querySelector('.demo-status')!.textContent;
const button = (name: string) => [...root.querySelectorAll('.toolbar button')].find((b) => b.textContent === name) as HTMLButtonElement;

async function choose(id: string): Promise<void> {
  const select = root.querySelector('select')!;
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await demo.controller()!.ready;
}

describe('Vanilla demo', () => {
  it('renders the toolbar, the editor in split mode and a status line', async () => {
    await mount();
    expect(root.querySelector('label[for]')!.textContent).toBe('Example');
    expect([...root.querySelectorAll('select option')].map((o) => o.textContent)).toEqual(EXAMPLES.map((e) => e.label));
    expect(root.querySelector('input[type="checkbox"]')!.parentElement!.textContent).toContain('Read-only');
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(true);
    expect(root.querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Theme');
    expect(demo.controller()!.getMode()).toBe('split');
    expect(root.querySelectorAll('textarea')).toHaveLength(1);
    expect(status()).toContain('kubernetes');
  });

  it.each([
    ['kubernetes', 'kubernetes'],
    ['compose', 'compose'],
    ['compose-external', 'compose'],
    ['empty', 'no format yet'],
  ])('choosing %s updates the status line', async (id, format) => {
    await mount();
    await choose(id === 'kubernetes' ? 'compose' : id); // leave the first example so the choice is a change
    if (id === 'kubernetes') await choose('kubernetes');
    const example = EXAMPLES.find((e) => e.id === id)!;
    await vi.waitFor(() => expect(status()).toContain(format));
    expect(demo.controller()!.getValue()).toBe(example.value);
    expect(root.querySelector('textarea')!.value).toBe(example.value);
  });

  it('recreates the editor for another variables store and keeps one textarea', async () => {
    await mount();
    const first = demo.controller();
    await choose('compose');
    expect(demo.controller()).toBe(first); // same store kind: updated in place
    await choose('compose-external');
    expect(demo.controller()).not.toBe(first);
    expect(root.querySelectorAll('.sw-editor')).toHaveLength(1);
    expect(root.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('read-only blocks typing', async () => {
    await mount();
    const original = demo.controller()!.getValue();
    const box = root.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    expect(demo.controller()!.getReadOnly()).toBe(true);
    adapter.instances.at(-1)!.type('kind: Pod');
    expect(demo.controller()!.getValue()).toBe(original);
    box.click();
    adapter.instances.at(-1)!.type('kind: Pod');
    expect(demo.controller()!.getValue()).toBe('kind: Pod');
  });

  it('Undo enables after typing and undoes', async () => {
    await mount();
    const original = demo.controller()!.getValue();
    adapter.instances.at(-1)!.type('kind: Pod');
    expect(button('Undo').disabled).toBe(false);
    expect(status()).toContain('last change: code');
    button('Undo').click();
    expect(demo.controller()!.getValue()).toBe(original);
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(false);
    button('Redo').click();
    expect(demo.controller()!.getValue()).toBe('kind: Pod');
  });

  it('Broken shows the banner and a problem count', async () => {
    await mount();
    await choose('broken');
    await vi.waitFor(() => {
      expect(root.querySelector<HTMLElement>('.sw-banner')!.hidden).toBe(false);
      expect(status()).toMatch(/\d+ problems?/);
      expect(status()).not.toContain('No problems');
    });
  });

  it('removes its DOM and editor on destroy', async () => {
    await mount();
    demo.destroy();
    expect(root.querySelector('.sw-editor')).toBeNull();
    expect(root.children).toHaveLength(0);
  });
});
