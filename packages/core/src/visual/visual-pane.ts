import { describeNode } from '../document/describe.js';
import type { StoreEvent } from '../document/store.js';
import type { NodeRef, ParsedText } from '../document/types.js';
import type { EditorContext, Pane } from '../editor/context.js';
import { h } from '../editor/dom.js';
import { kindKey } from '../formats/guide.js';
import { createBanner } from './banner.js';
import { makeLabelFor } from './labels.js';
import { buildOutline, nodeId } from './outline-model.js';
import type { OutlineNode } from './outline-model.js';
import { createOutline } from './outline.js';
import { createAddResource } from './picker.js';
import { createRemoveControl } from './remove-section.js';
import { mountSection } from './section.js';
import { isRecord, safeData } from './util.js';
import type { Section, SectionSlots } from './section.js';

/** How long after the last `'code'` change the visual pane re-renders. */
const CODE_SYNC_MS = 100;

const NO_SLOTS: SectionSlots = { field: () => undefined, addSlot: () => undefined };

/**
 * Creates the visual pane: the broken-YAML banner, the outline tree and the section of the
 * selected node. While the text does not parse it shows the last good parse, read-only.
 * @param o.slots - Fills the section's rows and add control; defaults to plain read-only rows.
 * @internal
 */
export function createVisualPane(
  ctx: EditorContext,
  o: { el: HTMLElement; slots?: SectionSlots },
): Pane & { refresh(): void; focusField(ref: NodeRef): boolean } {
  const doc = o.el.ownerDocument;
  const ui = ctx.messages.ui;
  const slots = o.slots ?? NO_SLOTS;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const requested = new Set<string>();
  const unknownKeys = new Set<string>();
  let selectedRef: NodeRef | undefined;
  let nodes: readonly OutlineNode[] = [];
  let flat = new Map<string, OutlineNode>();
  let section: { id: string; handle: Section } | undefined;
  let card: HTMLElement | undefined;
  let stale = false;

  const jump = (): void => {
    // The parse's own errors are always for the current text; published problems can lag a debounce behind it.
    const first = ctx.store.parsed.errors[0] ?? ctx.problems().find((p) => p.code === 'yaml.syntax');
    if (first) ctx.editInCode({ from: first.from, to: first.to });
  };
  const banner = createBanner(doc, ui, jump);
  const outline = createOutline(doc, {
    label: ui.outlineLabel,
    onSelect: (n) => {
      choose(n.ref);
      // Split mode: the code pane follows the outline (frame 2). Not while the text is broken: its ranges are stale.
      if (!ctx.store.parsed.ok) return;
      const view = describeNode(ctx.store.parsed, n.ref);
      if (view) ctx.revealRange(view.keyRange ?? view.range);
    },
  });
  const title = h(doc, 'h2', { class: 'sw-section-title', tabindex: '-1' });
  const crumbList = h(doc, 'ol', { class: 'sw-crumb-list' });
  const crumbs = h(doc, 'nav', { class: 'sw-section-crumbs', 'aria-label': ui.sectionPathLabel }, [crumbList]);
  const empty = h(doc, 'p', { class: 'sw-visual-empty', hidden: true, tabindex: '-1' }, [ui.visualEmpty]);
  const addResource = createAddResource(ctx, doc);
  // After a removal focus must stay on something visible: the section's title, or, when nothing is
  // left, the add button (else the empty message) rather than the hidden section.
  const removal = createRemoveControl(ctx, doc, () => {
    if (nodes.length > 0) title.focus();
    else if (!addResource.el.hidden && !addResource.el.disabled) addResource.el.focus();
    else empty.focus();
  });
  const header = h(doc, 'header', { class: 'sw-section-header' }, [title, crumbs, removal.el]);
  const content = h(doc, 'div', { class: 'sw-section-content' });
  const host = h(doc, 'div', { class: 'sw-section-host' }, [header, content]);
  const body = h(doc, 'div', { class: 'sw-visual-body' }, [outline.el, host]);
  const toolbar = h(doc, 'div', { class: 'sw-visual-toolbar' }, [addResource.el]);
  o.el.append(banner.el, toolbar, body, empty);

  const bundleKeyOf = (parsed: ParsedText, d: number): string | undefined => {
    const f = ctx.format();
    if (!f) return undefined;
    if (f.rootModel === 'mapping') return f.id;
    const data = safeData(parsed, d);
    const apiVersion = isRecord(data) ? data['apiVersion'] : undefined;
    const kind = isRecord(data) ? data['kind'] : undefined;
    return typeof apiVersion === 'string' && typeof kind === 'string' ? kindKey(apiVersion, kind) : undefined;
  };

  /** Starts each schema load once; labels and unknown kinds are known when it resolves. */
  function requestBundles(parsed: ParsedText): void {
    const f = ctx.format();
    if (!f) return;
    const docs = f.rootModel === 'mapping' ? [0] : parsed.docs.map((_, i) => i);
    for (const d of docs) {
      const key = bundleKeyOf(parsed, d);
      if (key === undefined || requested.has(key)) continue;
      requested.add(key);
      const stamp = generation;
      void ctx.loadBundle(d).then((bundle) => {
        if (destroyed || stamp !== generation) return;
        if (!bundle && f.rootModel === 'documents' && ctx.bundleError(d) === undefined) unknownKeys.add(key);
        render(); // not flush: a pending 100 ms code debounce must keep running
      });
    }
  }

  /** The outline node at `ref`, or its nearest ancestor that is one. */
  const nearest = (ref: NodeRef): OutlineNode | undefined => {
    for (let n = ref.path.length; n >= 0; n--) {
      const hit = flat.get(nodeId({ doc: ref.doc, path: ref.path.slice(0, n) }));
      if (hit) return hit;
    }
    return undefined;
  };

  function showCard(node: OutlineNode, parsed: ParsedText | undefined, broken: boolean): void {
    section?.handle.destroy();
    section = undefined;
    card?.remove();
    const view = parsed ? describeNode(parsed, node.ref) : undefined;
    const link = h(doc, 'button', { type: 'button', class: 'sw-link', disabled: broken || !view }, [ui.editInCode]);
    link.addEventListener('click', () => {
      if (view) ctx.editInCode(view.range);
    });
    card = h(doc, 'div', { class: 'sw-unknown-kind' }, [h(doc, 'p', {}, [ui.unknownKind]), link]);
    content.append(card);
  }

  function renderSelection(sel: OutlineNode | undefined, parsed: ParsedText | undefined, broken: boolean): void {
    body.hidden = nodes.length === 0;
    empty.hidden = nodes.length > 0;
    removal.setTarget(sel ? { ref: sel.ref, label: sel.label } : undefined);
    if (!sel) {
      section?.handle.destroy();
      section = undefined;
      card?.remove();
      card = undefined;
      return;
    }
    title.textContent = sel.label;
    const chain: string[] = [];
    for (let n = 0; n <= sel.ref.path.length; n++) {
      const hit = flat.get(nodeId({ doc: sel.ref.doc, path: sel.ref.path.slice(0, n) }));
      if (hit) chain.push(hit.label);
    }
    crumbList.replaceChildren(
      ...chain.map((label, i) => {
        const last = i === chain.length - 1;
        return h(doc, 'li', { class: 'sw-crumb' }, [
          h(doc, 'span', last ? { class: 'sw-crumb-label', 'aria-current': 'location' } : { class: 'sw-crumb-label' }, [label]),
          ...(last ? [] : [h(doc, 'span', { class: 'sw-crumb-sep', 'aria-hidden': 'true' }, ['›'])]),
        ]);
      }),
    );
    if (sel.unknownKind) {
      showCard(sel, parsed, broken);
      return;
    }
    card?.remove();
    card = undefined;
    if (section?.id === sel.id) {
      section.handle.update();
      return;
    }
    section?.handle.destroy();
    const handle = mountSection(ctx, sel.ref, slots, doc);
    section = { id: sel.id, handle };
    content.append(handle.el);
  }

  function render(): void {
    if (o.el.hidden) {
      stale = true; // rendered when the pane is shown again
      return;
    }
    stale = false;
    const broken = !ctx.store.parsed.ok;
    const parsed = broken ? ctx.store.lastGood : ctx.store.parsed;
    const format = ctx.format();
    banner.show(broken);
    addResource.update();
    toolbar.hidden = addResource.el.hidden;
    o.el.toggleAttribute('data-sw-readonly', broken || ctx.readOnly());
    if (parsed && format) requestBundles(parsed);
    nodes = parsed && format
      ? buildOutline(parsed, format, makeLabelFor(ctx, parsed), ui, (_d, apiVersion, kind) => unknownKeys.has(kindKey(apiVersion, kind)), (r) => slots.manages?.(r) === true)
      : [];
    flat = new Map();
    const index = (list: readonly OutlineNode[]): void => {
      for (const n of list) {
        flat.set(n.id, n);
        index(n.children);
      }
    };
    index(nodes);
    const sel = (selectedRef ? nearest(selectedRef) : undefined) ?? nodes[0];
    outline.update(nodes, sel?.id);
    renderSelection(sel, parsed, broken);
  }

  function flush(): void {
    if (destroyed) return;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    render();
  }

  function choose(ref: NodeRef): void {
    selectedRef = ref;
    flush();
  }

  // A pending re-render must not move things under the user's pointer or caret.
  const flushPending = (): void => {
    if (timer !== undefined) flush();
  };
  o.el.addEventListener('pointerdown', flushPending, true);
  o.el.addEventListener('focusin', flushPending, true);
  const offProblems = ctx.onProblems(() => {
    if (o.el.hidden) stale = true; // the rows' problems are re-read when the pane is shown again
    else section?.handle.update();
  });

  render();

  return {
    el: o.el,
    update(e: StoreEvent | null) {
      if (destroyed) return;
      if (e === null) {
        generation++;
        requested.clear();
        unknownKeys.clear();
        flush();
      } else if (e.origin === 'code') {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          render();
        }, CODE_SYNC_MS);
      } else {
        flush();
      }
    },
    reveal(ref: NodeRef) {
      if (destroyed) return false;
      if (o.el.hidden) {
        selectedRef = ref;
        stale = true;
        return false;
      }
      flushPending();
      const hit = nearest(ref);
      if (!hit) return false;
      selectedRef = hit.ref;
      flush();
      outline.expandTo(hit.id);
      return true;
    },
    focusField(ref: NodeRef) {
      if (destroyed || o.el.hidden) return false;
      flushPending();
      flush(); // the schema may have loaded since the last render
      const hit = nearest(ref);
      if (!hit || section?.id !== hit.id) return false;
      const key = ref.path[hit.ref.path.length];
      if (key !== undefined && section.handle.focusRow(key)) return true;
      title.focus();
      return false;
    },
    refresh() {
      if (!destroyed && stale && !o.el.hidden) flush();
    },
    setReadOnly() {
      flush();
    },
    destroy() {
      destroyed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      offProblems();
      addResource.destroy();
      o.el.removeEventListener('pointerdown', flushPending, true);
      o.el.removeEventListener('focusin', flushPending, true);
      section?.handle.destroy();
      outline.destroy();
      o.el.replaceChildren();
    },
  };
}
