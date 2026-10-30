import { h } from '../editor/dom.js';
import type { OutlineNode } from './outline-model.js';

/**
 * The outline tree (WAI-ARIA APG Tree View).
 * @internal
 */
export interface Outline {
  /** The `.sw-outline` element holding the tree. */
  readonly el: HTMLElement;
  /** Shows `nodes`, marking `selectedId` as selected. Expansion and focus are kept by node id. */
  update(nodes: readonly OutlineNode[], selectedId: string | undefined): void;
  /** Expands the ancestors of `id` so it is visible. */
  expandTo(id: string): void;
  /** Releases the outline. */
  destroy(): void;
}

interface Entry {
  node: OutlineNode;
  parent: string | undefined;
  level: number;
}

/**
 * Creates the outline. Arrow keys move focus, Right and Left open, close and walk, Enter, Space and
 * click select; only the focused item is in the tab order (roving tabindex).
 * @internal
 */
export function createOutline(doc: Document, o: { label: string; onSelect(node: OutlineNode): void }): Outline {
  const tree = h(doc, 'ul', { class: 'sw-outline-tree', role: 'tree', 'aria-label': o.label });
  const el = h(doc, 'div', { class: 'sw-outline' }, [tree]);
  let entries = new Map<string, Entry>();
  let roots: readonly OutlineNode[] = [];
  const expanded = new Set<string>();
  const seen = new Set<string>();
  let selectedId: string | undefined;
  let focusId: string | undefined;

  const isVisible = (id: string): boolean => {
    for (let p = entries.get(id)?.parent; p !== undefined; p = entries.get(p)?.parent) if (!expanded.has(p)) return false;
    return true;
  };
  const visibleIds = (): string[] => {
    const out: string[] = [];
    const walk = (nodes: readonly OutlineNode[]): void => {
      for (const n of nodes) {
        out.push(n.id);
        if (n.children.length > 0 && expanded.has(n.id)) walk(n.children);
      }
    };
    walk(roots);
    return out;
  };
  const itemEl = (id: string): HTMLElement | undefined =>
    [...tree.querySelectorAll<HTMLElement>('[role=treeitem]')].find((i) => i.dataset['swId'] === id);

  const build = (nodes: readonly OutlineNode[], level: number): HTMLElement[] =>
    nodes.map((n) => {
      const parent = n.children.length > 0;
      const toggle = h(doc, 'span', { class: 'sw-outline-toggle', 'aria-hidden': 'true' }, [parent ? (expanded.has(n.id) ? '▾' : '▸') : '']);
      toggle.dataset['swToggle'] = parent ? 'true' : 'false';
      const li = h(
        doc,
        'li',
        {
          role: 'treeitem',
          class: 'sw-outline-item',
          'aria-level': String(level),
          'aria-selected': String(n.id === selectedId),
          'aria-expanded': parent ? String(expanded.has(n.id)) : undefined,
          tabindex: n.id === focusId ? '0' : '-1',
          'data-sw-id': n.id,
          'data-sw-readonly': n.readOnly !== undefined ? 'true' : undefined,
          'data-sw-unknown': n.unknownKind ? 'true' : undefined,
        },
        [toggle, h(doc, 'span', { class: 'sw-outline-label' }, [n.label])],
      );
      if (parent) {
        const group = h(doc, 'ul', { role: 'group', class: 'sw-outline-group' }, build(n.children, level + 1));
        group.hidden = !expanded.has(n.id);
        li.append(group);
      }
      return li;
    });

  function render(): void {
    const active = doc.activeElement;
    const hadFocus = active !== null && tree.contains(active);
    tree.replaceChildren(...build(roots, 1));
    if (hadFocus && focusId !== undefined) itemEl(focusId)?.focus();
  }

  /** Makes `id` the one item in the tab order. */
  const setRoving = (id: string): void => {
    if (focusId === id) return;
    const prev = focusId !== undefined ? itemEl(focusId) : undefined;
    if (prev) prev.tabIndex = -1;
    focusId = id;
    const next = itemEl(id);
    if (next) next.tabIndex = 0;
  };
  const focusItem = (id: string): void => {
    setRoving(id);
    itemEl(id)?.focus();
  };
  const setExpanded = (id: string, open: boolean): void => {
    if (open) expanded.add(id);
    else expanded.delete(id);
    const li = itemEl(id);
    if (!li) return;
    li.setAttribute('aria-expanded', String(open));
    const group = li.querySelector<HTMLElement>(':scope > [role=group]');
    if (group) group.hidden = !open;
    const toggle = li.querySelector(':scope > .sw-outline-toggle');
    if (toggle) toggle.textContent = open ? '▾' : '▸';
  };
  const select = (id: string): void => {
    const e = entries.get(id);
    if (e) o.onSelect(e.node);
  };

  tree.addEventListener('keydown', (ev) => {
    const target = ev.target as HTMLElement;
    if (target.getAttribute('role') !== 'treeitem') return;
    const id = target.dataset['swId'];
    const entry = id !== undefined ? entries.get(id) : undefined;
    if (id === undefined || !entry) return;
    const ids = visibleIds();
    const at = ids.indexOf(id);
    const hasKids = entry.node.children.length > 0;
    let handled = true;
    switch (ev.key) {
      case 'ArrowDown':
        if (at < ids.length - 1) focusItem(ids[at + 1]!);
        break;
      case 'ArrowUp':
        if (at > 0) focusItem(ids[at - 1]!);
        break;
      case 'Home':
        focusItem(ids[0]!);
        break;
      case 'End':
        focusItem(ids[ids.length - 1]!);
        break;
      case 'ArrowRight':
        if (hasKids) {
          if (!expanded.has(id)) setExpanded(id, true);
          else focusItem(entry.node.children[0]!.id);
        }
        break;
      case 'ArrowLeft':
        if (hasKids && expanded.has(id)) setExpanded(id, false);
        else if (entry.parent !== undefined) focusItem(entry.parent);
        break;
      case 'Enter':
      case ' ':
        select(id);
        break;
      default:
        handled = false;
    }
    if (handled) ev.preventDefault();
  });

  tree.addEventListener('focusin', (ev) => {
    const target = ev.target as HTMLElement;
    const id = target.getAttribute('role') === 'treeitem' ? target.dataset['swId'] : undefined;
    if (id !== undefined) setRoving(id);
  });

  tree.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement;
    const li = target.closest<HTMLElement>('[role=treeitem]');
    const id = li?.dataset['swId'];
    if (!li || id === undefined) return;
    if (target.closest('.sw-outline-toggle') && entries.get(id)?.node.children.length) {
      setExpanded(id, !expanded.has(id));
      focusItem(id);
      return;
    }
    focusItem(id);
    select(id);
  });

  return {
    el,
    update(nodes, selected) {
      roots = nodes;
      const next = new Map<string, Entry>();
      const index = (list: readonly OutlineNode[], parent: string | undefined, level: number): void => {
        for (const n of list) {
          next.set(n.id, { node: n, parent, level });
          // Documents (and other roots) start open; everything else starts closed.
          if (!seen.has(n.id)) {
            seen.add(n.id);
            if (parent === undefined && n.children.length > 0) expanded.add(n.id);
          }
          index(n.children, n.id, level + 1);
        }
      };
      index(nodes, undefined, 1);
      entries = next;
      for (const id of [...expanded]) if (!entries.has(id)) expanded.delete(id);
      for (const id of [...seen]) if (!entries.has(id)) seen.delete(id);
      selectedId = selected !== undefined && entries.has(selected) ? selected : undefined;
      const ids = visibleIds();
      if (focusId === undefined || !entries.has(focusId) || !isVisible(focusId)) {
        focusId = selectedId !== undefined && ids.includes(selectedId) ? selectedId : ids[0];
      }
      render();
    },
    expandTo(id) {
      for (let p = entries.get(id)?.parent; p !== undefined; p = entries.get(p)?.parent) {
        if (!expanded.has(p)) setExpanded(p, true);
      }
    },
    destroy() {
      tree.replaceChildren();
    },
  };
}
