import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { EXAMPLES, textareaAdapter } from '@stack-weaver/demo-kit';
import type { TextareaAdapter } from '@stack-weaver/demo-kit';
import { AppComponent } from './app.component';

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;
let fixture: ComponentFixture<AppComponent>;

beforeEach(() => {
  errors = vi.spyOn(console, 'error');
  adapter = textareaAdapter();
  localStorage.clear();
});
afterEach(async () => {
  fixture.destroy();
  expect(errors).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  await new Promise((r) => setTimeout(r, 0));
});

const root = () => fixture.nativeElement as HTMLElement;
const controller = () => fixture.componentInstance.editor().controller();
const status = () => root().querySelector('.demo-status')!.textContent;
const button = (name: string) =>
  [...root().querySelectorAll('.toolbar button')].find((b) => b.textContent === name) as HTMLButtonElement;

async function mount(): Promise<void> {
  fixture = TestBed.createComponent(AppComponent);
  fixture.componentRef.setInput('codeEditor', adapter);
  await fixture.whenStable();
  await vi.waitFor(() => expect(controller()).toBeDefined());
  await controller()!.ready;
  await fixture.whenStable();
}

async function choose(id: string): Promise<void> {
  const select = root().querySelector('select')!;
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await fixture.whenStable();
  await controller()!.ready;
  await fixture.whenStable();
}

describe('Angular demo', () => {
  it('renders the toolbar, the editor in split mode and a status line', async () => {
    await mount();
    expect(root().querySelector('label[for]')!.textContent).toBe('Example');
    expect([...root().querySelectorAll('select option')].map((o) => o.textContent)).toEqual(EXAMPLES.map((e) => e.label));
    expect(root().querySelector('input[type="checkbox"]')!.parentElement!.textContent).toContain('Read-only');
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(true);
    expect(root().querySelector('[role="radiogroup"]')!.getAttribute('aria-label')).toBe('Theme');
    expect(controller()!.getMode()).toBe('split');
    expect(root().querySelectorAll('textarea')).toHaveLength(1);
    // The wrapper's own host is the .demo-editor box (parity with the Vanilla demo).
    expect(root().querySelector('sw-manifest-editor')!.classList.contains('demo-editor')).toBe(true);
    await vi.waitFor(() => expect(status()).toContain('kubernetes'));
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
    expect(controller()!.getValue()).toBe(example.value);
    expect(root().querySelector('textarea')!.value).toBe(example.value);
  });

  it('recreates the editor for another variables store and keeps one textarea', async () => {
    await mount();
    const first = controller();
    await choose('compose');
    expect(controller()).toBe(first); // same store kind: updated in place
    await choose('compose-external');
    expect(controller()).not.toBe(first);
    expect(root().querySelectorAll('.sw-editor')).toHaveLength(1);
    expect(root().querySelectorAll('textarea')).toHaveLength(1);
  });

  // Both are recreations (a new variables store kind): the new editor starts with no format and no problems.
  it('choosing Empty after Compose with external variables clears the format', async () => {
    await mount();
    await choose('compose-external');
    await vi.waitFor(() => expect(status()).toContain('compose'));
    await choose('empty');
    await vi.waitFor(() => expect(status()).toContain('no format yet'));
  });

  it('choosing Compose with external variables after Broken clears the problems', async () => {
    await mount();
    await choose('broken');
    await vi.waitFor(() => expect(status()).toMatch(/\d+ problems?/));
    await choose('compose-external');
    await vi.waitFor(() => expect(status()).toContain('No problems'));
  });

  it('read-only blocks typing', async () => {
    await mount();
    const original = controller()!.getValue();
    const box = root().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.click();
    await fixture.whenStable();
    expect(controller()!.getReadOnly()).toBe(true);
    adapter.instances.at(-1)!.type('kind: Pod');
    expect(controller()!.getValue()).toBe(original);
    box.click();
    await fixture.whenStable();
    adapter.instances.at(-1)!.type('kind: Pod');
    expect(controller()!.getValue()).toBe('kind: Pod');
  });

  it('Undo enables after typing and undoes', async () => {
    await mount();
    const original = controller()!.getValue();
    adapter.instances.at(-1)!.type('kind: Pod');
    await fixture.whenStable();
    expect(button('Undo').disabled).toBe(false);
    expect(status()).toContain('last change: code');
    button('Undo').click();
    await fixture.whenStable();
    expect(controller()!.getValue()).toBe(original);
    expect(button('Undo').disabled).toBe(true);
    expect(button('Redo').disabled).toBe(false);
    button('Redo').click();
    await fixture.whenStable();
    expect(controller()!.getValue()).toBe('kind: Pod');
  });

  it('Broken shows the banner and a problem count', async () => {
    await mount();
    await choose('broken');
    await vi.waitFor(() => {
      expect(root().querySelector<HTMLElement>('.sw-banner')!.hidden).toBe(false);
      expect(status()).toMatch(/\d+ problems?/);
      expect(status()).not.toContain('No problems');
    });
  });

  it('removes its DOM and editor on destroy', async () => {
    await mount();
    fixture.destroy();
    expect(root().querySelector('.sw-editor')).toBeNull();
    expect(root().querySelector('textarea')).toBeNull();
  });

  it('the theme radio group stores the theme, applies it and moves with the arrow keys', async () => {
    await mount();
    const radios = [...root().querySelectorAll<HTMLButtonElement>('[aria-label="Theme"] [role="radio"]')];
    expect(radios.map((r) => r.textContent)).toEqual(['Auto', 'Light', 'Dark']);
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);

    radios[2]!.click();
    await fixture.whenStable();
    expect(localStorage.getItem('stack-weaver-site-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(radios[2]!.getAttribute('aria-checked')).toBe('true');

    radios[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await fixture.whenStable();
    expect(radios[0]!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radios[0]);
  });

  it('follows a theme stored by another frame', async () => {
    await mount();
    localStorage.setItem('stack-weaver-site-theme', 'dark');
    window.dispatchEvent(new StorageEvent('storage', { key: 'stack-weaver-site-theme' }));
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(root().querySelectorAll('[aria-label="Theme"] [role="radio"]')[2]!.getAttribute('aria-checked')).toBe('true');
  });
});
