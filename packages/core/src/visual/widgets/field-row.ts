import { describeNode } from '../../document/describe.js';
import type { NodeView } from '../../document/describe.js';
import type { ParsedText, YamlValue } from '../../document/types.js';
import type { EditorContext } from '../../editor/context.js';
import { h } from '../../editor/dom.js';
import { resolveAt } from '../../engine/resolve.js';
import type { ResolvedSchema } from '../../engine/resolve.js';
import { guideFieldOf } from '../../formats/guide.js';
import type { SchemaBundle } from '../../formats/types.js';
import type { Problem } from '../../validation/problems.js';
import type { FieldRowHandle, FieldRowInit, SectionSlots } from '../section.js';
import { destroyAddSlot, renderAddSlot, updateAddSlot } from '../add-slot.js';
import { isRecord, safeData } from '../util.js';
import { createWidgetContext } from './context.js';
import { pickWidget } from './registry.js';
import type { WidgetInstance, WidgetRegistry } from './types.js';

let nextId = 0;

/** Built-in widgets that edit one scalar. The two list widgets edit a collection. */
const LIST_WIDGETS: Readonly<Record<string, 'map' | 'seq'>> = { 'key-value': 'map', 'string-list': 'seq', 'secret-data': 'map' };
const SCALAR_WIDGETS = new Set(['string', 'number', 'integer', 'boolean', 'enum', 'int-or-string', 'quantity', 'suggest', 'ref', 'ref-key']);

/** What one render of a parse knows: its data, and the schema at any path (memoised per parse and bundle). */
interface Env {
  readonly parsed: ParsedText;
  readonly bundle: SchemaBundle | undefined;
  resolve(path: readonly (string | number)[]): ResolvedSchema | undefined;
}

function createEnvs(ctx: EditorContext): (parsed: ParsedText, doc: number) => Env {
  const cache = new Map<number, { parsed: ParsedText; bundle: SchemaBundle | undefined; env: Env }>();
  return (parsed, doc) => {
    const bundle = ctx.bundleFor(doc);
    const hit = cache.get(doc);
    if (hit && hit.parsed === parsed && hit.bundle === bundle) return hit.env;
    let data: { value: unknown } | undefined;
    const resolved = new Map<string, ResolvedSchema | undefined>();
    const env: Env = {
      parsed,
      bundle,
      resolve(path) {
        if (!bundle) return undefined;
        const key = JSON.stringify(path);
        if (!resolved.has(key)) {
          data ??= { value: safeData(parsed, doc) };
          let r: ResolvedSchema | undefined;
          try {
            r = resolveAt(bundle, path, data.value);
          } catch {
            r = undefined;
          }
          resolved.set(key, r);
        }
        return resolved.get(key);
      },
    };
    cache.set(doc, { parsed, bundle, env });
    return env;
  };
}

type Mode = 'text' | 'unknown' | 'card' | 'widget';

/**
 * The widgets of the visual pane: fills {@link SectionSlots.field} with one schema-driven row per
 * field. The widget comes from the guide, then the schema shape; nothing here looks at field names.
 * @param registry - Built-in widgets with the host's merged over them.
 * @internal
 */
export function createFieldSlots(ctx: EditorContext, registry: WidgetRegistry): SectionSlots {
  const envFor = createEnvs(ctx);
  return {
    field: (init) => createFieldRow(ctx, registry, envFor, init),
    manages(ref) {
      const key = ref.path[ref.path.length - 1];
      const parsed = ctx.store.parsed.ok ? ctx.store.parsed : ctx.store.lastGood;
      const env = parsed ? envFor(parsed, ref.doc) : undefined;
      const child = env?.bundle ? env.resolve(ref.path) : undefined;
      if (typeof key !== 'string' || !env || !child) return false;
      const picked = pickWidget(child, guideFieldOf(ctx.guide(), env.resolve(ref.path.slice(0, -1)), key), registry);
      return picked !== undefined && registry[picked.name]?.managesKeys === true;
    },
    addSlot: (ref) => renderAddSlot(ctx, ref, document, registry),
    updateAddSlot,
    destroyAddSlot,
  };
}

function createFieldRow(ctx: EditorContext, registry: WidgetRegistry, envFor: (p: ParsedText, doc: number) => Env, init: FieldRowInit): FieldRowHandle {
  const doc = document;
  const ui = ctx.messages.ui;
  const { ref, key } = init;
  const id = `sw-f${nextId++}`;

  const labelEl = h(doc, 'label', { class: 'sw-row-label', id: `${id}-label` });
  const badge = h(doc, 'span', { class: 'sw-badge' }, [ui.required]);
  const removeBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-row-remove' }, ['×']);
  const head = h(doc, 'div', { class: 'sw-row-head' }, [labelEl, removeBtn]);
  const descEl = h(doc, 'p', { class: 'sw-row-description', id: `${id}-desc`, hidden: true });
  const body = h(doc, 'div', { class: 'sw-row-body' });
  const noteEl = h(doc, 'p', { class: 'sw-row-note', hidden: true });
  const errorEl = h(doc, 'p', { class: 'sw-field-error sw-row-error', hidden: true });
  const problemsEl = h(doc, 'ul', { class: 'sw-row-problems', id: `${id}-problems`, hidden: true });
  const rowEl = h(doc, 'div', { class: 'sw-row', 'data-sw-key': String(key) }, [head, descEl, body, noteEl, errorEl, problemsEl]);

  let sectionLabel = String(key);
  let label = sectionLabel;
  let modeKey = '';
  let widget: WidgetInstance | undefined;
  let valueEl: HTMLElement | undefined;
  let cardBtn: HTMLButtonElement | undefined;
  let lastView: NodeView = init.view;
  let readOnlyNow = false;
  let problemsSig = '';
  let destroyed = false;

  removeBtn.addEventListener('click', () => {
    const r = ctx.store.edit({ op: 'delete', at: ref });
    errorEl.textContent = r.ok ? '' : ui.editRefused;
    errorEl.hidden = r.ok;
  });

  const editInCode = (): HTMLButtonElement => {
    const link = h(doc, 'button', { type: 'button', class: 'sw-link' }, [ui.editInCode]);
    link.addEventListener('click', () => ctx.revealRange(lastView.range));
    return link;
  };

  function dropBody(): void {
    widget?.destroy?.();
    widget = undefined;
    valueEl = undefined;
    cardBtn = undefined;
    body.replaceChildren();
    labelEl.removeAttribute('for');
  }

  /** Describes `ref` over the parse the row shows. */
  function currentView(parsed: ParsedText | undefined): NodeView {
    return (parsed ? describeNode(parsed, ref) : undefined) ?? init.view;
  }

  function build(mode: Mode, picked: { name: string; param?: string } | undefined, child: ResolvedSchema | undefined, description: string, value: YamlValue, view: NodeView, options: readonly string[] | undefined): void {
    dropBody();
    if (mode === 'widget' && picked && child) {
      const factory = registry[picked.name]!;
      try {
        const wctx = createWidgetContext(
          ctx.store,
          {
          id,
          label,
          description,
          ref,
          value,
          schema: child.schema,
          readOnly: readOnlyNow,
          ...(picked.param !== undefined && { param: picked.param }),
          ...(options !== undefined && { options }),
          messages: ui,
        }, () => readOnlyNow);
        widget = factory(wctx);
      } catch (err) {
        console.error(`stack-weaver: the "${picked.name}" widget failed`, err);
      }
      if (widget) {
        body.append(widget.el);
        const primary = widget.el.id === id ? widget.el : widget.el.querySelector<HTMLElement>(`[id="${id}"]`);
        if (primary) {
          const describedBy = [primary.getAttribute('aria-describedby'), descEl.id, problemsEl.id].filter(Boolean).join(' ');
          primary.setAttribute('aria-describedby', describedBy);
          if (primary.matches('input, select, textarea, button')) labelEl.setAttribute('for', id);
        }
        return;
      }
      mode = view.type === 'scalar' ? 'text' : 'card';
    }
    if (mode === 'card') {
      cardBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-row-card' });
      cardBtn.addEventListener('click', () => ctx.select(ref));
      body.append(cardBtn);
      return;
    }
    // 'text' and 'unknown': the value as read-only text.
    valueEl = h(doc, 'span', { class: 'sw-row-value' });
    body.append(valueEl);
    if (mode === 'unknown') body.append(' ', editInCode());
  }

  function update(value: YamlValue, readOnly: boolean, problems: readonly Problem[]): void {
    if (destroyed) return;
    readOnlyNow = readOnly;
    const broken = !ctx.store.parsed.ok;
    const parsed = broken ? ctx.store.lastGood : ctx.store.parsed;
    const view = currentView(parsed);
    lastView = view;
    const env = parsed ? envFor(parsed, ref.doc) : undefined;
    const ready = env?.bundle !== undefined;
    const parent = ready ? env.resolve(ref.path.slice(0, -1)) : undefined;
    const child = ready ? env.resolve(ref.path) : undefined;
    const gf = typeof key === 'string' ? guideFieldOf(ctx.guide(), parent, key) : undefined;

    // What to show.
    let mode: Mode;
    let picked: { name: string; param?: string } | undefined;
    if (view.type === 'alias') mode = 'unknown';
    else if (!ready) mode = view.type === 'scalar' ? 'text' : 'card';
    else if (!child) mode = 'unknown';
    else {
      picked = pickWidget(child, gf, registry);
      const list = picked ? LIST_WIDGETS[picked.name] : undefined;
      const fits = picked !== undefined && (list !== undefined ? view.type === list : view.type === 'scalar' || !SCALAR_WIDGETS.has(picked.name));
      mode = fits ? 'widget' : view.type === 'scalar' ? 'text' : 'card';
    }
    const nextKey = mode === 'widget' && picked ? `widget:${picked.name}:${picked.param ?? ''}` : mode;

    // Label: the guide's, else an item's name, else the section's.
    const itemName = typeof key === 'number' && isRecord(value) && typeof value['name'] === 'string' && value['name'] !== '' ? value['name'] : undefined;
    label = gf?.label ?? itemName ?? sectionLabel;
    const description = gf?.description ?? child?.description ?? '';

    if (nextKey !== modeKey) {
      modeKey = nextKey;
      build(mode, picked, child, description, value, view, gf?.options);
    }

    labelEl.textContent = label;
    removeBtn.setAttribute('aria-label', ui.removeField.replace('{label}', label));
    removeBtn.disabled = readOnly;
    const required = typeof key === 'string' && parent?.required.includes(key) === true;
    if (required && !badge.isConnected) head.insertBefore(badge, removeBtn);
    else if (!required) badge.remove();
    descEl.textContent = description;
    descEl.hidden = description === '';

    const notes: string[] = [];
    if (view.type === 'scalar' && view.anchor !== undefined) notes.push(ui.aliasNote);
    if (mode === 'unknown') notes.push(view.type === 'alias' ? ui.readOnlyNode : ui.unknownField);
    noteEl.textContent = notes.join(' ');
    noteEl.hidden = notes.length === 0;

    if (valueEl) {
      const shown = view.type === 'scalar' ? (view.value === null || view.value === undefined ? '' : String(view.value)) : ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
      if (valueEl.textContent !== shown) valueEl.textContent = shown;
    }
    if (cardBtn) {
      const text = ui.openSection.replace('{label}', label);
      if (cardBtn.textContent !== text) cardBtn.textContent = text;
    }
    widget?.update(value, readOnly);

    const sig = problems.map((p) => `${p.severity}\u0000${p.message}`).join('\u0001');
    if (sig !== problemsSig) {
      problemsSig = sig;
      problemsEl.replaceChildren(
        ...problems.map((p) =>
          h(doc, 'li', { class: `sw-row-problem sw-row-problem-${p.severity}` }, [
            h(doc, 'span', { class: 'sw-sr-only' }, [`${p.severity === 'error' ? ui.severityError : p.severity === 'warning' ? ui.severityWarning : ui.severityInfo}: `]),
            p.message,
          ]),
        ),
      );
    }
    problemsEl.hidden = problems.length === 0;
  }

  return {
    el: rowEl,
    update,
    setLabel(l) {
      sectionLabel = l;
    },
    focus() {
      if (widget) widget.focus();
      else (cardBtn ?? rowEl.querySelector<HTMLElement>('button'))?.focus();
    },
    destroy() {
      destroyed = true;
      dropBody();
      rowEl.remove();
    },
  };
}
