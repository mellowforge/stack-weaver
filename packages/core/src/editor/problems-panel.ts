import type { Problem, Severity } from '../validation/problems.js';
import { h } from './dom.js';
import { formatMessage } from './format-message.js';
import type { UiMessages } from './messages.js';
import { problemCountText } from './problems.js';

/**
 * The collapsible list of problems under the panes.
 * @internal
 */
export interface ProblemsPanel {
  /** Shows `problems`; the panel is hidden while there are none. */
  update(problems: readonly Problem[]): void;
  /** Disables the fix buttons while the editor is read-only. */
  setReadOnly(readOnly: boolean): void;
  /** Says that a quick fix applied elsewhere (the code pane) was refused, until the problems change or a fix applies. */
  showRefused(): void;
}

// Three different shapes, so severity never rests on colour alone; the text alternative is
// the visually hidden label next to the icon.
const ICONS: Record<Severity, string> = { error: '✖', warning: '▲', info: '●' };

let nextId = 0;

/**
 * Fills `host` (the shell's `.sw-problems` element) with a toggle and the list. Each item is a
 * button; `onSelect` receives the problem it stands for. A problem with a quick fix gets a second,
 * sibling button (never nested); `onFix` applies it and returns whether it did, and then the
 * focus moves to the toggle because the item it was in is gone. A refused fix leaves the focus on
 * its button and shows `editRefused` in an alert after the list (outside it, so it stays visible
 * while the list is collapsed). When an update hides the panel while the focus is inside it,
 * `restoreFocus` hands the focus to a visible target.
 * @internal
 */
export function createProblemsPanel(
  host: HTMLElement,
  o: { ui: UiMessages; locale: string; onSelect(problem: Problem): void; onFix(problem: Problem): boolean; restoreFocus(): void },
): ProblemsPanel {
  const doc = host.ownerDocument;
  const listId = `sw-problem-list-${++nextId}`;
  const label: Record<Severity, string> = { error: o.ui.severityError, warning: o.ui.severityWarning, info: o.ui.severityInfo };
  const toggle = h(doc, 'button', { type: 'button', class: 'sw-problems-toggle', 'aria-expanded': 'true', 'aria-controls': listId });
  const list = h(doc, 'ul', { class: 'sw-problem-list', id: listId, role: 'list' });
  const status = h(doc, 'p', { class: 'sw-field-error sw-problems-status', role: 'alert' });
  host.append(toggle, list, status);
  const clearStatus = (): void => {
    if (status.textContent !== '') status.textContent = '';
  };
  // Always written, even with the same text: the new text node makes the alert speak for every refusal.
  const showRefused = (): void => {
    status.textContent = o.ui.editRefused;
  };

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
  });

  let readOnly = false;

  return {
    setReadOnly(v) {
      readOnly = v;
      for (const b of list.querySelectorAll<HTMLButtonElement>('.sw-problem-fix')) b.disabled = v;
    },
    showRefused,
    update(problems) {
      clearStatus();
      const hiding = problems.length === 0;
      if (hiding && !host.hidden && host.contains(doc.activeElement)) o.restoreFocus();
      host.hidden = hiding;
      toggle.textContent = formatMessage(o.ui.problemsSummary, { label: o.ui.problemsLabel, count: problemCountText(o.ui, problems.length, o.locale) });
      const items = problems.map((p, i) => {
        const button = h(doc, 'button', { type: 'button', class: 'sw-problem', 'data-sw-severity': p.severity }, [
          h(doc, 'span', { class: 'sw-problem-icon', 'aria-hidden': 'true' }, [ICONS[p.severity]]),
          h(doc, 'span', { class: 'sw-visually-hidden' }, [formatMessage(o.ui.problemPrefix, { severity: label[p.severity] })]),
          h(doc, 'span', { class: 'sw-problem-message', id: `${listId}-msg-${i}` }, [p.message]),
          h(doc, 'span', { class: 'sw-problem-pos' }, [`${p.line}:${p.col}`]),
        ]);
        button.addEventListener('click', () => o.onSelect(p));
        const { fix } = p;
        if (!fix) return h(doc, 'li', {}, [button]);
        const fixButton = h(doc, 'button', { type: 'button', class: 'sw-problem-fix', 'aria-describedby': `${listId}-msg-${i}` }, [fix.label]);
        fixButton.disabled = readOnly;
        fixButton.addEventListener('click', () => {
          if (o.onFix(p)) {
            clearStatus();
            toggle.focus();
          } else showRefused(); // the focus stays on this button
        });
        return h(doc, 'li', { class: 'sw-problem-item' }, [button, fixButton]);
      });
      list.replaceChildren(...items);
    },
  };
}
