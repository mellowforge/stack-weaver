import type { Severity } from '../validation/problems.js';
import type { Problem } from '../validation/problems.js';
import { h } from './dom.js';
import type { UiMessages } from './messages.js';
import { problemCountText } from './problems.js';

/**
 * The collapsible list of problems under the panes.
 * @internal
 */
export interface ProblemsPanel {
  /** Shows `problems`; the panel is hidden while there are none. */
  update(problems: readonly Problem[]): void;
}

// Three different shapes, so severity never rests on colour alone; the text alternative is
// the visually hidden label next to the icon.
const ICONS: Record<Severity, string> = { error: '✖', warning: '▲', info: '●' };

let nextId = 0;

/**
 * Fills `host` (the shell's `.sw-problems` element) with a toggle and the list. Each item is a
 * button; `onSelect` receives the problem it stands for.
 * @internal
 */
export function createProblemsPanel(host: HTMLElement, o: { ui: UiMessages; onSelect(problem: Problem): void }): ProblemsPanel {
  const doc = host.ownerDocument;
  const listId = `sw-problem-list-${++nextId}`;
  const label: Record<Severity, string> = { error: o.ui.severityError, warning: o.ui.severityWarning, info: o.ui.severityInfo };
  const toggle = h(doc, 'button', { type: 'button', class: 'sw-problems-toggle', 'aria-expanded': 'true', 'aria-controls': listId });
  const list = h(doc, 'ul', { class: 'sw-problem-list', id: listId });
  host.append(toggle, list);

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
  });

  return {
    update(problems) {
      host.hidden = problems.length === 0;
      toggle.textContent = `${o.ui.problemsLabel}: ${problemCountText(o.ui, problems.length)}`;
      const items = problems.map((p) => {
        const button = h(doc, 'button', { type: 'button', class: 'sw-problem', 'data-sw-severity': p.severity }, [
          h(doc, 'span', { class: 'sw-problem-icon', 'aria-hidden': 'true' }, [ICONS[p.severity]]),
          h(doc, 'span', { class: 'sw-visually-hidden' }, [`${label[p.severity]}: `]),
          h(doc, 'span', { class: 'sw-problem-message' }, [p.message]),
          h(doc, 'span', { class: 'sw-problem-pos' }, [`${p.line}:${p.col}`]),
        ]);
        button.addEventListener('click', () => o.onSelect(p));
        return h(doc, 'li', {}, [button]);
      });
      list.replaceChildren(...items);
    },
  };
}
