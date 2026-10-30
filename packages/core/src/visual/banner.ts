import { h } from '../editor/dom.js';
import type { UiMessages } from '../editor/messages.js';

/**
 * The broken-YAML banner of the visual pane.
 * @internal
 */
export interface Banner {
  /** The `.sw-banner` element (`role="alert"`). */
  readonly el: HTMLElement;
  /** Shows or hides the banner. */
  show(visible: boolean): void;
}

/** Builds the banner; `onJump` runs when the user asks to go to the first error. */
export function createBanner(doc: Document, ui: UiMessages, onJump: () => void): Banner {
  const button = h(doc, 'button', { type: 'button', class: 'sw-btn sw-banner-jump' }, [ui.jumpToError]);
  button.addEventListener('click', onJump);
  const el = h(doc, 'div', { class: 'sw-banner', role: 'alert', hidden: true }, [
    h(doc, 'span', { class: 'sw-banner-text' }, [ui.bannerBroken]),
    button,
  ]);
  return {
    el,
    show(visible) {
      el.hidden = !visible;
    },
  };
}
