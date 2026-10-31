import type { EditorView, Tooltip } from '@codemirror/view';
import type { HoverInfo } from '../../assist/hover.js';
import { stateToCm, stateToText } from './offsets.js';

/**
 * The `hoverTooltip` source: asks `hover` with the full text and a text offset, and places the
 * tooltip at the CodeMirror positions of the range it answers with.
 * @internal
 */
export function hoverSource(
  hover: (text: string, offset: number) => HoverInfo | undefined | Promise<HoverInfo | undefined>,
): (view: EditorView, pos: number) => Tooltip | null | Promise<Tooltip | null> {
  return async (view, pos) => {
    const s = view.state;
    let info: HoverInfo | undefined;
    try {
      info = await hover(s.sliceDoc(), stateToText(s, pos));
    } catch {
      return null; // a failing hover shows no tooltip
    }
    if (!info) return null;
    return hoverTooltipFor({ ...info, from: stateToCm(s, info.from), to: stateToCm(s, info.to) }, view.dom.ownerDocument);
  };
}

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
