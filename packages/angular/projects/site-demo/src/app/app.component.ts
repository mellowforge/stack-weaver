import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, signal, viewChild, viewChildren } from '@angular/core';
import { SwManifestEditor } from '@stack-weaver/angular';
import type { ChangeOrigin, CodeEditorAdapter } from '@stack-weaver/core';
import { EXAMPLES, THEMES, THEME_KEY, applyPageTheme, readTheme, statusLine, writeTheme } from '@stack-weaver/demo-kit';
import type { SiteTheme } from '@stack-weaver/demo-kit';

let instance = 0;

/**
 * The Angular demo: the same toolbar, split-mode editor and status line as the Vanilla and React demos.
 * `codeEditor` replaces the CodeMirror adapter (tests); pass a stable value.
 */
@Component({
  selector: 'app-root',
  imports: [SwManifestEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="angular-app">
      <div class="toolbar" role="group" aria-label="Demo controls">
        <label [for]="uid + '-example'">Example</label>
        <select [id]="uid + '-example'" [value]="example().id" (change)="choose($any($event.target).value)">
          @for (ex of examples; track ex.id) {
            <option [value]="ex.id" [selected]="ex.id === example().id">{{ ex.label }}</option>
          }
        </select>
        <label>
          <input type="checkbox" [checked]="readOnly()" (change)="readOnly.set($any($event.target).checked)" /> Read-only
        </label>
        <button type="button" class="button" [disabled]="!history().canUndo" (click)="editor().controller()?.undo()">Undo</button>
        <button type="button" class="button" [disabled]="!history().canRedo" (click)="editor().controller()?.redo()">Redo</button>
        <div class="segmented" role="radiogroup" aria-label="Theme" (keydown)="onThemeKey($event)">
          @for (t of themes; track t.theme) {
            <button
              #radio
              type="button"
              role="radio"
              class="segmented__option"
              [attr.aria-checked]="t.theme === theme()"
              [tabIndex]="t.theme === theme() ? 0 : -1"
              (click)="setTheme(t.theme)"
            >{{ t.label }}</button>
          }
        </div>
      </div>
      <sw-manifest-editor
        class="demo-editor"
        [codeEditor]="codeEditor()"
        [(value)]="value"
        mode="split"
        [format]="example().format"
        [variables]="example().variables"
        [readOnly]="readOnly()"
        [theme]="theme()"
        (textChange)="origin.set($event.origin)"
        (problemsChange)="problems.set($event.length)"
        (activeFormatChange)="activeFormat.set($event)"
        (historyChange)="history.set($event)"
      />
      <p class="demo-status" role="status">{{ status() }}</p>
    </div>
  `,
})
export class AppComponent {
  readonly codeEditor = input<CodeEditorAdapter | undefined>();
  readonly editor = viewChild.required(SwManifestEditor);
  private readonly radios = viewChildren<ElementRef<HTMLButtonElement>>('radio');

  protected readonly uid = `demo-ng${++instance}`;
  protected readonly examples = EXAMPLES;
  protected readonly themes = THEMES;
  protected readonly example = signal(EXAMPLES[0]!);
  protected readonly value = signal(EXAMPLES[0]!.value);
  protected readonly readOnly = signal(false);
  protected readonly theme = signal<SiteTheme>(readTheme());
  protected readonly history = signal({ canUndo: false, canRedo: false });
  protected readonly problems = signal(0);
  protected readonly activeFormat = signal<string | undefined>(undefined);
  protected readonly origin = signal<ChangeOrigin | undefined>(undefined);
  protected readonly status = () =>
    statusLine({ problems: this.problems(), activeFormat: this.activeFormat(), origin: this.origin() });

  constructor() {
    applyPageTheme(document, this.theme());
    // The theme changes in another frame of the site (the landing page switch): follow it.
    const onStorage = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== THEME_KEY) return;
      const next = readTheme();
      applyPageTheme(document, next);
      this.theme.set(next);
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  protected choose(id: string): void {
    const next = EXAMPLES.find((e) => e.id === id)!;
    this.example.set(next);
    this.value.set(next.value);
    this.origin.set(undefined);
  }

  protected setTheme(theme: SiteTheme): void {
    writeTheme(theme);
    applyPageTheme(document, theme);
    this.theme.set(theme);
  }

  protected onThemeKey(e: KeyboardEvent): void {
    const from = this.radios().findIndex((r) => r.nativeElement === e.target);
    if (from < 0) return;
    const n = THEMES.length;
    let to: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        to = (from + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        to = (from + n - 1) % n;
        break;
      case 'Home':
        to = 0;
        break;
      case 'End':
        to = n - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    this.setTheme(THEMES[to]!.theme);
    this.radios()[to]!.nativeElement.focus();
  }
}
