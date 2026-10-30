import type { Tooltip } from '@codemirror/view';
import type { HoverInfo } from '../../assist/hover.js';

/** Builds the hover tooltip for `info`. Content is set with `textContent` only, never as markup. */
export function hoverTooltipFor(info: HoverInfo, doc: Document): Tooltip {
  return {
    pos: info.from,
    end: info.to,
    above: true,
    create() {
      const dom = doc.createElement('div');
      dom.className = 'sw-hover';
      const title = doc.createElement('div');
      title.className = 'sw-hover-title';
      title.textContent = info.title;
      dom.appendChild(title);
      if (info.description) {
        const description = doc.createElement('div');
        description.className = 'sw-hover-description';
        description.textContent = info.description;
        dom.appendChild(description);
      }
      return { dom };
    },
  };
}
