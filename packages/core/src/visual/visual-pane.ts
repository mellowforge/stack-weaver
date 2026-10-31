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
import { mountVariablesSection } from './variables-section.js';
import { isRecord, safeData } from './util.js';
import type { Section, SectionSlots } from './section.js';

/** How long after the last `'code'` change the visual pane re-renders. */
const CODE_SYNC_MS = 100;

const VARIABLES_ID = 'variables';

/** Gives the Variables section the shape of a node section; it has no rows to focus by key. */
const variablesAsSection = (v: ReturnType<typeof mountVariablesSection>): Section => ({
  el: v.el,
  update: () => v.update(),
  focusRow: () => false,
  destroy: () => v.destroy(),
});

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
): Pane & { refresh(): void; focusField(ref: NodeRef): boolean; setNotice(text: string | undefined): void } {
  const doc = o.el.ownerDocument;
  const ui = ctx.messages.ui;
  const slots = o.slots ?? NO_SLOTS;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const requested = new Set<string>();
  const unknownKeys = new Set<string>();
  let selectedRef: NodeRef | undefined;
  /** The Variables section is the selection. Tracked apart from `selectedRef`: it has no path of its own. */
  let variablesSelected = false;
  /** A reveal made while the pane was hidden; the next render selects it if it resolves to a node. */
  let pendingReveal: NodeRef | undefined;
  let nodes: readonly OutlineNode[] = [];
  let flat = new Map<string, OutlineNode>();
  /** The mounted section, and the kind key of its document when it last rendered (see `holdSection`). */
  let section: { id: string; handle: Section; key: string | undefined } | undefined;
  let card: HTMLElement | undefined;
  let stale = false;
  /** The origin of the latest store change (`undefined` after a format change); renders it causes later, such as a schema load, see it too. */
  let origin: StoreEvent['origin'] | undefined;
  /** True while the mounted section is held as it is (see `holdSection`). */
  let held = false;

  const jump = (): void => {
    // The parse's own errors are always for the current text; published problems can lag a debounce behind it.
    const first = ctx.store.parsed.errors[0] ?? ctx.problems().find((p) => p.code === 'yaml.syntax');
    if (first) ctx.editInCode({ from: first.from, to: first.to });
  };
  const banner = createBanner(doc, ui, jump);
  const outline = createOutline(doc, {
    label: ui.outlineLabel,
    onSelect: (n) => {
      variablesSelected = n.type === 'variables';
      choose(n.ref);
      if (n.type === 'variables') return; // no text of its own to reveal
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

  /** The root key of the variables block when it is shown as the Variables section instead of as a node. */
  const hiddenKey = (): string | undefined => {
    const vs = ctx.variables();
    return vs?.kind === 'x-variables' ? ctx.format()?.variables?.key : undefined;
  };

  const bundleKeyOf = (parsed: ParsedText, d: number): string | undefined => {
    const f = ctx.format();
    if (!f) return undefined;
    if (f.rootModel === 'mapping') return f.id;
    const data = safeData(parsed, d);
    const apiVersion = isRecord(data) ? data['apiVersion'] : undefined;
    const kind = isRecord(data) ? data['kind'] : undefined;
    return typeof apiVersion === 'string' && typeof kind === 'string' ? kindKey(apiVersion, kind) : undefined;
  };

  /**
   * Starts each schema load once; labels and unknown kinds are known when it resolves. A load that
   * failed is started again by a later render (not by the render that shows the failure, which
   * would retry in a loop).
   */
  function requestBundles(parsed: ParsedText): void {
    const f = ctx.format();
    if (!f) return;
    const docs = f.rootModel === 'mapping' ? [0] : Array.from({ length: parsed.docCount }, (_, i) => i);
    for (const d of docs) {
      const key = bundleKeyOf(parsed, d);
      if (key === undefined || requested.has(key)) continue;
      requested.add(key);
      const stamp = generation;
      void ctx.loadBundle(d).then((bundle) => {
        if (destroyed || stamp !== generation) return;
        const failed = !bundle && ctx.bundleError(d) !== undefined;
        if (!bundle && f.rootModel === 'documents' && !failed) unknownKeys.add(key);
        render(); // not flush: a pending code debounce must keep running
        if (failed) requested.delete(key);
      });
    }
  }

  /** The outline node at `ref`, or its nearest ancestor that is one. */
  const nearest = (ref: NodeRef): OutlineNode | undefined => {
    for (let n = ref.path.length; n >= 0; n--) {
      const hit = flat.get(nodeId({ doc: ref.doc, path: ref.path.slice(0, n) }));
      if (hit) return hit;
    }
    // The hidden variables block has no node of its own: its section stands for it. The root does
    // not (a root-path problem leaves the selection as it is).
    const key = hiddenKey();
    return ref.doc === 0 && key !== undefined && ref.path[0] === key ? flat.get(VARIABLES_ID) : undefined;
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

  /**
   * Whether to keep the mounted section as it is instead of rendering `sel`. Typing a new
   * `apiVersion` or `kind` into the section commits every keystroke, and each partial value names
   * another kind (most of them unknown): re-rendering for it would replace the very input being
   * typed in. So while a visual edit changes the kind key of the section's document and focus is
   * in the section, the section is held; leaving it renders again (`onSectionFocusOut`). Any
   * other change (code, undo, the API) renders as usual.
   */
  function holdSection(sel: OutlineNode, parsed: ParsedText | undefined): boolean {
    if (origin !== 'visual' || !parsed || section?.id !== sel.id || !section.handle.el.contains(doc.activeElement)) return false;
    return bundleKeyOf(parsed, sel.ref.doc) !== section.key;
  }

  /** The key of the section row that holds `el`, if any. */
  const rowKeyOf = (el: Element | null): string | undefined => {
    const row = el && section?.handle.el.contains(el) ? el.closest<HTMLElement>('.sw-row') : null;
    return row?.dataset['swKey'];
  };

  function onSectionFocusOut(e: FocusEvent): void {
    const next = e.relatedTarget;
    if (!held || (next instanceof Node && section?.handle.el.contains(next))) return;
    held = false;
    render();
  }
  content.addEventListener('focusout', onSectionFocusOut);

  function renderSelection(sel: OutlineNode | undefined, parsed: ParsedText | undefined, broken: boolean): void {
    const wasHeld = held;
    held = sel !== undefined && holdSection(sel, parsed);
    if (held) return;
    body.hidden = nodes.length === 0;
    empty.hidden = nodes.length > 0;
    removal.setTarget(sel && sel.type !== 'variables' ? { ref: sel.ref, label: sel.label } : undefined);
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
    const key = parsed ? bundleKeyOf(parsed, sel.ref.doc) : undefined;
    if (section?.id === sel.id && !wasHeld) {
      section.key = key;
      section.handle.update();
      return;
    }
    // A held section missed its updates (its widgets still remember the values from before the
    // hold), so it is built again rather than updated; the row that had focus gets it back.
    const focusedKey = wasHeld ? rowKeyOf(doc.activeElement) : undefined;
    section?.handle.destroy();
    const handle: Section = sel.type === 'variables' ? variablesAsSection(mountVariablesSection(ctx, doc)) : mountSection(ctx, sel.ref, slots, doc);
    section = { id: sel.id, handle, key };
    content.append(handle.el);
    if (focusedKey !== undefined) handle.focusRow(focusedKey);
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
    const outlined = parsed && format
      ? buildOutline(
          parsed,
          format,
          makeLabelFor(ctx, parsed),
          ui,
          (_d, apiVersion, kind) => unknownKeys.has(kindKey(apiVersion, kind)),
          (r) => slots.manages?.(r) === true,
          hiddenKey(),
          ctx.guide(),
        )
      : [];
    nodes = parsed && format && ctx.variables()
      ? [{ id: VARIABLES_ID, ref: { doc: 0, path: [] }, label: ui.variables, type: 'variables', children: [] }, ...outlined]
      : outlined;
    flat = new Map();
    const index = (list: readonly OutlineNode[]): void => {
      for (const n of list) {
        flat.set(n.id, n);
        index(n.children);
      }
    };
    index(nodes);
    if (pendingReveal) {
      // Like a reveal on a shown pane: a ref with no node (such as the root) leaves the selection as it is.
      const hit = nearest(pendingReveal);
      pendingReveal = undefined;
      if (hit) {
        selectedRef = hit.ref;
        variablesSelected = hit.type === 'variables';
      }
    }
    if (!flat.has(VARIABLES_ID)) variablesSelected = false; // the node is gone (for example after a format change): a later one is not the selection
    const sel =
      (variablesSelected ? flat.get(VARIABLES_ID) : undefined) ??
      (selectedRef ? nearest(selectedRef) : undefined) ??
      nodes.find((n) => n.type !== 'variables') ??
      nodes[0];
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
    else if (!held) section?.handle.update();
  });

  render();

  return {
    el: o.el,
    update(e: StoreEvent | null) {
      if (destroyed) return;
      origin = e?.origin;
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
        pendingReveal = ref; // the outline may be stale: resolved by the render that shows the pane
        stale = true;
        return false;
      }
      pendingReveal = undefined;
      flushPending();
      const hit = nearest(ref);
      if (!hit) return false;
      selectedRef = hit.ref;
      variablesSelected = hit.type === 'variables';
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
    setNotice(text) {
      // Replaces the empty-state message, for example when the formats failed to load.
      empty.textContent = text ?? ui.visualEmpty;
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
      content.removeEventListener('focusout', onSectionFocusOut);
      section?.handle.destroy();
      outline.destroy();
      o.el.replaceChildren();
    },
  };
}
