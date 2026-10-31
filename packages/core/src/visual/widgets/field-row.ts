import { describeNode } from '../../document/describe.js';
import type { NodeView } from '../../document/describe.js';
import type { ParsedText, YamlValue } from '../../document/types.js';
import type { EditorContext } from '../../editor/context.js';
import { h } from '../../editor/dom.js';
import { resolveAt } from '../../engine/resolve.js';
import type { ResolvedSchema } from '../../engine/resolve.js';
import { guideFieldOf } from '../../formats/guide.js';
import type { JsonSchema, SchemaBundle } from '../../formats/types.js';
import { sameProblemList } from '../../validation/problems.js';
import type { Problem } from '../../validation/problems.js';
import type { FieldRowHandle, FieldRowInit, SectionSlots } from '../section.js';
import { destroyAddSlot, renderAddSlot, updateAddSlot } from '../add-slot.js';
import { isRecord, safeData } from '../util.js';
import { createWidgetContext } from './context.js';
import { fitsField } from '../../variables/fit.js';
import { pickWidget } from './registry.js';
import { mountVariableBinding } from './variable-binding.js';
import type { WidgetInstance, WidgetRef, WidgetRegistry } from './types.js';
import { formatMessage } from '../../editor/format-message.js';

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

type Mode = 'text' | 'unknown' | 'card' | 'widget' | 'variable';

/** Widgets that cannot display arbitrary text (a checkbox, a select): they never show a string they cannot hold, unless it is a placeholder. */
const TYPED_WIDGETS = new Set(['boolean', 'enum']);

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
  const toggleBtn = h(doc, 'button', { type: 'button', class: 'sw-btn sw-row-variable-toggle', 'aria-label': ui.useVariable, 'aria-pressed': 'false' }, [
    h(doc, 'span', { 'aria-hidden': 'true' }, ['${}']),
  ]);
  const head = h(doc, 'div', { class: 'sw-row-head' }, [labelEl, removeBtn]);
  const descEl = h(doc, 'p', { class: 'sw-row-description', id: `${id}-desc`, hidden: true });
  const body = h(doc, 'div', { class: 'sw-row-body' });
  const noteEl = h(doc, 'p', { class: 'sw-row-note', hidden: true });
  const errorEl = h(doc, 'p', { class: 'sw-field-error sw-row-error', role: 'alert', hidden: true });
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
  let shownProblems: readonly Problem[] = [];
  let lastValue: YamlValue = null;
  let lastProblems: readonly Problem[] = [];
  let lastSchema: JsonSchema | undefined;
  /** The user's choice that the value does not show yet: `var` after pressing the toggle, `typed` after un-pressing a placeholder that stays. */
  let override: 'var' | 'typed' | undefined;
  let fixButtons: HTMLButtonElement[] = [];
  let destroyed = false;

  removeBtn.addEventListener('click', () => {
    const r = ctx.store.edit({ op: 'delete', at: ref });
    errorEl.textContent = r.ok ? '' : ui.editRefused;
    errorEl.hidden = r.ok;
  });

  const editInCode = (): HTMLButtonElement => {
    const link = h(doc, 'button', { type: 'button', class: 'sw-link' }, [ui.editInCode]);
    link.addEventListener('click', () => ctx.editInCode(lastView.range));
    return link;
  };
  // Shown while the widget failed (its factory or its `update` threw): the field is read-only text.
  const failEl = h(doc, 'p', { class: 'sw-row-note sw-row-failed', hidden: true });
  rowEl.insertBefore(failEl, errorEl);
  let failed = false;
  let widgetName = '';

  /** Drops a widget that threw (in its factory, `update` or `focus`) and shows the value as read-only text instead (with `failEl`). */
  function widgetFailed(err: unknown): void {
    console.error(`stack-weaver: the "${widgetName}" widget failed`, err);
    failed = true;
    try {
      widget?.destroy?.();
    } catch {
      // It already failed; the body is cleared below either way.
    }
    widget = undefined;
    dropBody();
    valueEl = h(doc, 'span', { class: 'sw-row-value' });
    body.append(valueEl);
  }

  function dropBody(): void {
    try {
      widget?.destroy?.();
    } catch (err) {
      // The row is cleared below either way: the widget's element goes with it.
      console.error(`stack-weaver: the "${widgetName}" widget failed`, err);
    }
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

  function build(mode: Mode, picked: WidgetRef | undefined, child: ResolvedSchema | undefined, description: string, value: YamlValue, view: NodeView, options: readonly string[] | undefined): void {
    dropBody();
    failed = false;
    if ((mode === 'widget' || mode === 'variable') && picked && child) {
      widgetName = mode === 'variable' ? 'variable' : picked.name;
      const factory = registry[picked.name]!.create;
      try {
        widget =
          mode === 'variable'
            ? mountVariableBinding(ctx, { id, label, ref, schema: child.schema, value, readOnly: readOnlyNow })
            : factory(
                createWidgetContext(
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
                  },
                  () => readOnlyNow,
                ),
              );
      } catch (err) {
        console.error(`stack-weaver: the "${widgetName}" widget failed`, err);
        failed = true;
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

  toggleBtn.addEventListener('click', () => {
    if (readOnlyNow) return;
    if (toggleBtn.getAttribute('aria-pressed') !== 'true') {
      override = 'var';
    } else {
      const name = typeof lastValue === 'string' ? ctx.format()?.variables?.referenceOf(lastValue) : undefined;
      const decl = name === undefined ? undefined : ctx.variables()?.get().find((d) => d.name === name);
      // Only a default that fits the field replaces the placeholder.
      const fallback = decl && (lastSchema === undefined || fitsField(decl, lastSchema)) ? decl.default : undefined;
      if (fallback !== undefined) {
        // The default replaces the placeholder; the typed widget shows once the store reports the edit.
        const r = ctx.store.edit({ op: 'set', at: ref, value: fallback });
        errorEl.textContent = r.ok ? '' : ui.editRefused;
        errorEl.hidden = r.ok;
        if (!r.ok) return;
        override = undefined;
      } else {
        override = name === undefined ? undefined : 'typed';
      }
    }
    update(lastValue, readOnlyNow, lastProblems);
  });

  /** Focuses the widget; when it has nothing to focus, or its `focus` throws, the row's first button instead. */
  function focusRow(): void {
    if (widget && !(widgetName === 'variable' && !body.querySelector('select'))) {
      try {
        widget.focus();
        return;
      } catch (err) {
        widgetFailed(err);
        update(lastValue, readOnlyNow, lastProblems); // shows the failure note, whose "Edit in code" takes the focus
      }
    }
    (cardBtn ?? failEl.querySelector<HTMLElement>('button') ?? rowEl.querySelector<HTMLElement>('button'))?.focus();
  }

  function update(value: YamlValue, readOnly: boolean, problems: readonly Problem[]): void {
    if (destroyed) return;
    readOnlyNow = readOnly;
    const broken = !ctx.store.parsed.ok;
    const parsed = broken ? ctx.store.lastGood : ctx.store.parsed;
    const view = currentView(parsed);
    lastView = view;
    lastValue = value;
    lastProblems = problems;
    const env = parsed ? envFor(parsed, ref.doc) : undefined;
    const ready = env?.bundle !== undefined;
    const parent = ready ? env.resolve(ref.path.slice(0, -1)) : undefined;
    const child = ready ? env.resolve(ref.path) : undefined;
    lastSchema = child?.schema;
    const gf = typeof key === 'string' ? guideFieldOf(ctx.guide(), parent, key) : undefined;

    // What to show.
    let mode: Mode;
    let picked: WidgetRef | undefined;
    if (view.type === 'alias') mode = 'unknown';
    else if (!ready) mode = view.type === 'scalar' ? 'text' : 'card';
    else if (!child) mode = 'unknown';
    else {
      picked = pickWidget(child, gf, registry);
      const list = picked ? LIST_WIDGETS[picked.name] : undefined;
      const fits = picked !== undefined && (list !== undefined ? view.type === list : view.type === 'scalar' || !SCALAR_WIDGETS.has(picked.name));
      mode = fits ? 'widget' : view.type === 'scalar' ? 'text' : 'card';
      // A checkbox or select never shows a string it cannot hold (a placeholder is handled below): the value is read-only text.
      if (mode === 'widget' && picked && TYPED_WIDGETS.has(picked.name) && view.type === 'scalar' && typeof view.value === 'string' && ctx.format()?.variables?.referenceOf(view.value) === undefined) {
        const allowed = picked.name === 'enum' ? child.schema['enum'] : undefined;
        if (picked.name === 'boolean' || (Array.isArray(allowed) && !allowed.includes(view.value))) mode = 'text';
      }
    }

    // A scalar field of a format with variables can be bound to a variable.
    const variables = ctx.variables() ? ctx.format()?.variables : undefined;
    const bindable = variables !== undefined && picked !== undefined && SCALAR_WIDGETS.has(picked.name) && view.type === 'scalar' && (mode === 'widget' || mode === 'text');
    const isRef = bindable && typeof value === 'string' && variables.referenceOf(value) !== undefined;
    if (!bindable || (override === 'typed' && !isRef) || (override === 'var' && isRef)) override = undefined;
    const varMode = bindable && (override === 'var' || (isRef && override !== 'typed'));
    if (varMode) mode = 'variable';
    // After un-pressing a placeholder that stays, the type widget shows as if the value were absent.
    const shown: YamlValue = override === 'typed' ? null : value;
    const nextKey = mode === 'widget' && picked ? `widget:${picked.name}:${picked.param ?? ''}` : mode;

    // Label: the guide's, else an item's name, else the section's.
    const itemName = typeof key === 'number' && isRecord(value) && typeof value['name'] === 'string' && value['name'] !== '' ? value['name'] : undefined;
    label = gf?.label ?? itemName ?? sectionLabel;
    const description = gf?.description ?? child?.description ?? '';

    // The same widget is not rebuilt after it failed: it would only fail again on every update.
    if (nextKey !== modeKey) {
      modeKey = nextKey;
      build(mode, picked, child, description, shown, view, gf?.options);
    }
    if (widget) {
      try {
        widget.update(shown, readOnly);
      } catch (err) {
        widgetFailed(err);
      }
    }
    // Filled only while it applies, so no hidden control sits in the row.
    if (failed && !failEl.hasChildNodes()) failEl.append(ui.widgetFailed, ' ', editInCode());
    else if (!failed && failEl.hasChildNodes()) failEl.replaceChildren();
    failEl.hidden = !failed;

    if (bindable && !toggleBtn.isConnected) head.insertBefore(toggleBtn, removeBtn);
    else if (!bindable && toggleBtn.isConnected) toggleBtn.remove();
    toggleBtn.setAttribute('aria-pressed', String(varMode));
    toggleBtn.disabled = readOnly;

    labelEl.textContent = label;
    removeBtn.setAttribute('aria-label', formatMessage(ui.removeField, { label }));
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
      const text = formatMessage(ui.openSection, { label });
      if (cardBtn.textContent !== text) cardBtn.textContent = text;
    }

    if (!sameProblemList(problems, shownProblems)) {
      shownProblems = problems;
      fixButtons = [];
      problemsEl.replaceChildren(
        ...problems.map((p, i) => {
          const msgId = `${id}-problem-${i}`;
          const li = h(doc, 'li', { class: `sw-row-problem sw-row-problem-${p.severity}` }, [
            h(doc, 'span', { id: msgId }, [
              h(doc, 'span', { class: 'sw-sr-only' }, [formatMessage(ui.problemPrefix, { severity: p.severity === 'error' ? ui.severityError : p.severity === 'warning' ? ui.severityWarning : ui.severityInfo })]),
              p.message,
            ]),
          ]);
          if (p.fix) {
            const fixBtn = h(doc, 'button', { type: 'button', class: 'sw-row-fix', 'aria-describedby': msgId }, [p.fix.label]);
            fixBtn.addEventListener('click', () => {
              const ok = ctx.applyFix(p).ok;
              errorEl.textContent = ok ? '' : ui.editRefused;
              errorEl.hidden = ok;
              // The button goes away with its problem: keep the focus on something that stays. A
              // refused fix leaves the button, and the focus on it.
              if (ok) focusRow();
            });
            fixButtons.push(fixBtn);
            li.append(' ', fixBtn);
          }
          return li;
        }),
      );
    }
    for (const b of fixButtons) b.disabled = readOnly;
    problemsEl.hidden = problems.length === 0;
  }

  return {
    el: rowEl,
    update,
    setLabel(l) {
      sectionLabel = l;
    },
    focus: focusRow,
    destroy() {
      destroyed = true;
      dropBody();
      rowEl.remove();
    },
  };
}
