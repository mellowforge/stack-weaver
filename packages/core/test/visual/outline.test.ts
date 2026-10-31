// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutline } from '../../src/visual/outline.js';
import type { OutlineNode } from '../../src/visual/outline-model.js';
import { focused } from '../helpers/focus.js';

const node = (path: (string | number)[], label: string, children: OutlineNode[] = [], type: OutlineNode['type'] = 'map'): OutlineNode => ({
  id: `0:${path.join('/')}`,
  ref: { doc: 0, path },
  label,
  type,
  children,
});
const tree = (): OutlineNode[] => [
  {
    ...node([], 'Deployment web', [
      node(['metadata'], 'metadata'),
      node(['spec'], 'spec', [node(['spec', 'template'], 'template')]),
    ]),
    type: 'document',
  },
  { ...node(['x'], 'Service s'), id: '1:', ref: { doc: 1, path: [] }, type: 'document' },
];

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});
afterEach(() => host.remove());

function mount() {
  const onSelect = vi.fn();
  const outline = createOutline(document, { label: 'Outline', onSelect });
  host.append(outline.el);
  outline.update(tree(), undefined);
  const items = () => [...host.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const item = (label: string) => items().find((i) => i.querySelector('.sw-outline-label')!.textContent === label)!;
  const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  return { outline, onSelect, items, item, key };
}

describe('outline (APG tree)', () => {
  it('a parent item is named by its label and its own text holds no nested item text (WCAG 2.5.3)', () => {
    const { items, item } = mount();
    const parent = item('Deployment web');
    expect(parent.getAttribute('aria-expanded')).toBe('true');
    const nameOf = (el: HTMLElement) => el.getAttribute('aria-labelledby')!.split(' ').map((id) => host.querySelector(`[id="${id}"]`)!.textContent).join(' ');
    for (const i of items()) {
      const label = i.querySelector('.sw-outline-label')!.textContent!;
      expect(nameOf(i)).toBe(label);
      // Axe's label-in-name check compares the item's visible text with its name: it must be only the label.
      expect(i.textContent).toBe(label);
    }
    const group = parent.parentElement!.querySelector<HTMLElement>(':scope > [role=group]')!;
    expect(group.contains(item('metadata'))).toBe(true);
    expect(parent.contains(group)).toBe(false);
  });

  it('role=tree with treeitems, aria-level, aria-expanded', () => {
    const { items, item } = mount();
    const tree = host.querySelector('[role=tree]')!;
    expect(tree.getAttribute('aria-label')).toBe('Outline');
    expect(item('Deployment web').getAttribute('aria-level')).toBe('1');
    expect(item('Deployment web').getAttribute('aria-expanded')).toBe('true');
    expect(item('metadata').getAttribute('aria-level')).toBe('2');
    expect(item('metadata').hasAttribute('aria-expanded')).toBe(false);
    expect(item('spec').getAttribute('aria-expanded')).toBe('false');
    const group = item('spec').parentElement!.querySelector<HTMLElement>(':scope > [role=group]');
    expect(group).not.toBeNull();
    expect(group!.hidden).toBe(true);
    expect(items().length).toBe(5);
  });

  it('only one treeitem has tabindex 0', () => {
    const { items, item, key } = mount();
    expect(items().filter((i) => i.tabIndex === 0).length).toBe(1);
    item('Deployment web').focus();
    key(item('Deployment web'), 'ArrowDown');
    expect(items().filter((i) => i.tabIndex === 0)).toEqual([item('metadata')]);
  });

  it('ArrowDown/ArrowUp/Home/End move focus', () => {
    const { item, key } = mount();
    item('Deployment web').focus();
    key(item('Deployment web'), 'ArrowDown');
    expect(focused()).toBe(item('metadata'));
    key(item('metadata'), 'ArrowDown');
    expect(focused()).toBe(item('spec')); // template is hidden under the collapsed spec
    key(item('spec'), 'End');
    expect(focused()).toBe(item('Service s'));
    key(item('Service s'), 'ArrowUp');
    expect(focused()).toBe(item('spec'));
    key(item('spec'), 'Home');
    expect(focused()).toBe(item('Deployment web'));
  });

  it('ArrowRight expands then enters, ArrowLeft collapses then goes to parent', () => {
    const { item, key } = mount();
    item('spec').focus();
    key(item('spec'), 'ArrowRight');
    expect(item('spec').getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toBe(item('spec'));
    key(item('spec'), 'ArrowRight');
    expect(focused()).toBe(item('template'));
    key(item('template'), 'ArrowRight'); // a leaf does nothing
    expect(focused()).toBe(item('template'));
    key(item('template'), 'ArrowLeft');
    expect(focused()).toBe(item('spec'));
    key(item('spec'), 'ArrowLeft');
    expect(item('spec').getAttribute('aria-expanded')).toBe('false');
    expect(focused()).toBe(item('spec'));
    key(item('spec'), 'ArrowLeft');
    expect(focused()).toBe(item('Deployment web'));
  });

  it('Enter/click selects', () => {
    const { item, key, onSelect, outline } = mount();
    item('metadata').focus();
    key(item('metadata'), 'Enter');
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'metadata' }));
    outline.update(tree(), '0:metadata');
    expect(item('metadata').getAttribute('aria-selected')).toBe('true');
    expect(item('spec').getAttribute('aria-selected')).toBe('false');
    item('Service s').querySelector<HTMLElement>('.sw-outline-label')!.click();
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ label: 'Service s' }));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('keeps focus and expansion across an update', () => {
    const { item, key, outline } = mount();
    item('spec').focus();
    key(item('spec'), 'ArrowRight');
    outline.update(tree(), '0:spec');
    expect(item('spec').getAttribute('aria-expanded')).toBe('true');
    expect(focused()).toBe(item('spec'));
  });

  it('expandTo opens the ancestors of a node', () => {
    const { item, outline } = mount();
    outline.expandTo('0:spec/template');
    expect(item('spec').getAttribute('aria-expanded')).toBe('true');
  });

  it('patches items in place, so an element under the pointer stays attached', () => {
    const { item, outline } = mount();
    const before = item('metadata');
    const [root, ...rest] = tree();
    const [meta, ...others] = root!.children;
    const next = [{ ...root!, children: [{ ...meta!, label: 'Metadata' }, ...others] }, ...rest];
    outline.update(next, undefined);
    expect(item('Metadata')).toBe(before);
    expect(before.isConnected).toBe(true);
  });
});
