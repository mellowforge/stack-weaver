import { Component, Injector, NgZone, afterEveryRender, provideZoneChangeDetection, signal, viewChild } from '@angular/core';
import { ComponentFixture, ComponentFixtureAutoDetect, TestBed } from '@angular/core/testing';
import type { MockInstance } from 'vitest';
import { textareaAdapter } from 'stack-weaver-demo-kit';
import type { TextareaAdapter } from 'stack-weaver-demo-kit';
import { SwManifestEditor } from './manifest-editor.component';

let errors: MockInstance<typeof console.error>;
let adapter: TextareaAdapter;

@Component({
  imports: [SwManifestEditor],
  template: `<sw-manifest-editor [codeEditor]="adapter" [(value)]="value" [guide]="guide()" />`,
})
class Host {
  readonly editor = viewChild.required(SwManifestEditor);
  readonly adapter = adapter;
  readonly value = signal('a: 1');
  readonly guide = signal<Record<string, never>>({});
}

const settle = () => new Promise((r) => setTimeout(r, 0)); // let anything scheduled run

/** Creates the host and waits for the editor to be ready. */
async function create(): Promise<ComponentFixture<Host>> {
  const f = TestBed.createComponent(Host);
  await f.whenStable();
  await f.componentInstance.editor().controller()!.ready;
  await f.whenStable();
  return f;
}

/** Counts Angular-zone entries and application ticks (afterEveryRender runs once per ApplicationRef tick). */
function track(): { entered: number; ticks: number; reset(): void; stop(): void } {
  const zone = TestBed.inject(NgZone);
  const counts = {
    entered: 0,
    ticks: 0,
    reset() {
      counts.entered = 0;
      counts.ticks = 0;
    },
    stop: () => sub.unsubscribe(),
  };
  const sub = zone.onUnstable.subscribe(() => counts.entered++);
  afterEveryRender(() => counts.ticks++, { injector: TestBed.inject(Injector) });
  return counts;
}

// zone.js is loaded for the whole suite by the unit-test builder (it is a devDependency);
// test-providers.ts keeps the other specs zoneless, this block opts into zone change detection.
describe('sw-manifest-editor with zone.js', () => {
  beforeEach(() => {
    errors = vi.spyOn(console, 'error');
    adapter = textareaAdapter();
    TestBed.configureTestingModule({
      providers: [provideZoneChangeDetection(), { provide: ComponentFixtureAutoDetect, useValue: true }],
    });
  });

  afterEach(async () => {
    expect(errors).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    await settle();
  });

  it('typing re-enters the zone once per change and updates [(value)]', async () => {
    const f = await create();
    const counts = track();
    // The first edit also turns canUndo on; the ones after it change only the text.
    adapter.instances.at(-1)!.type('a: 2');
    await f.whenStable();
    await settle();
    counts.reset();

    adapter.instances.at(-1)!.type('a: 3');
    expect(counts.entered).toBe(1);
    expect(f.componentInstance.value()).toBe('a: 3');
    adapter.instances.at(-1)!.type('a: 4');
    expect(counts.entered).toBe(2);
    await settle();
    expect(counts.entered).toBe(2);
    expect(counts.ticks).toBeGreaterThan(0);
    expect(f.componentInstance.value()).toBe('a: 4');
    expect(f.nativeElement.querySelector('textarea').value).toBe('a: 4');
    counts.stop();
  });

  it("the editor's own DOM listeners do not trigger app ticks", async () => {
    const f = await create();
    const zone = TestBed.inject(NgZone);
    const counts = track();

    // positive control (a real zone, not the zoneless no-op): work inside the zone ticks the app
    zone.run(() => {});
    await settle();
    expect(counts.entered).toBe(1);
    expect(counts.ticks).toBe(1);

    // Render hooks run outside the zone already; a recreation (in an effect, inside the zone) is the real test.
    for (const phase of ['created', 'recreated']) {
      if (phase === 'recreated') {
        const old = f.componentInstance.editor().controller();
        f.componentInstance.guide.set({});
        await f.whenStable();
        await f.componentInstance.editor().controller()!.ready;
        expect(f.componentInstance.editor().controller()).not.toBe(old);
        await settle();
      }
      counts.reset();
      const root: HTMLElement = f.nativeElement.querySelector('.sw-editor');
      const visual: HTMLElement = f.nativeElement.querySelector('.sw-visual-body');
      const textarea: HTMLTextAreaElement = f.nativeElement.querySelector('textarea');
      root.dispatchEvent(new Event('pointermove', { bubbles: true }));
      root.dispatchEvent(new Event('scroll'));
      // Events the core does listen to, but that change nothing here.
      visual.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      visual.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      await settle();
      expect(counts.entered, phase).toBe(0);
      expect(counts.ticks, phase).toBe(0);
    }

    const root: HTMLElement = f.nativeElement.querySelector('.sw-editor');
    // control: the same event on a listener added inside the zone does tick
    zone.run(() => root.addEventListener('pointermove', () => {}));
    await settle();
    counts.reset();
    root.dispatchEvent(new Event('pointermove', { bubbles: true }));
    await settle();
    expect(counts.entered).toBeGreaterThan(0);
    expect(counts.ticks).toBeGreaterThan(0);
    counts.stop();
  });
});
