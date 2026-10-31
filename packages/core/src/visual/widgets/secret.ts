import type { YamlValue } from '../../document/types.js';
import { h } from '../../editor/dom.js';
import { frame, removeButton } from './collections.js';
import type { WidgetFactory } from './types.js';

/** The base64 text of `text` encoded as UTF-8. */
function encode(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The text that base64 `raw` holds, or `undefined` when `raw` is not base64 or does not hold valid
 * UTF-8 (`atob` throws a `DOMException`, the strict `TextDecoder` a `TypeError`).
 */
function decode(raw: string): string | undefined {
  try {
    const binary = atob(raw);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

interface Entry {
  readonly el: HTMLElement;
  readonly name: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly warning: HTMLElement;
  readonly remove: HTMLButtonElement;
}

/**
 * The `data` of a Secret (guide widget `secret-data`): one row per key showing the decoded UTF-8
 * text, writing it back as base64. A value that is not base64-encoded UTF-8 text is shown as
 * stored, read-only, with a warning; so is text with a carriage return, which a text area cannot
 * hold unchanged. Values are text areas, so multi-line text (certificates, keys) keeps its line
 * breaks. Its registry entry declares `managesKeys`: there is no "Add key", new values go in `stringData`.
 */
export const secretDataWidget: WidgetFactory = (ctx) => {
  const ui = ctx.messages;
  const f = frame(ctx, 'secret-data');
  f.adder.remove();
  const rows = new Map<string, Entry>();
  let current: Readonly<Record<string, YamlValue>> = {};
  let readOnlyNow = ctx.readOnly;
  let nextWarning = 0;
  const at = (key: string): { doc: number; path: (string | number)[] } => ({ doc: ctx.ref.doc, path: [...ctx.ref.path, key] });

  const makeRow = (key: string): Entry => {
    const name = h(f.doc, 'span', { class: 'sw-secret-key' });
    const warning = h(f.doc, 'span', { class: 'sw-field-warning', id: `${ctx.id}-warning-${nextWarning++}`, hidden: true });
    // A textarea keeps line breaks (certificates, keys); it holds exactly the text that is encoded.
    const input = h(f.doc, 'textarea', { rows: '1', class: 'sw-input sw-secret-value', autocomplete: 'off', spellcheck: 'false', 'data-sw-entry': key });
    input.addEventListener('input', () => {
      if (input.readOnly) return;
      f.fail(ctx.edit({ op: 'set', at: at(key), value: encode(input.value) }));
    });
    const remove = removeButton(ctx, `${ctx.label} ${key}`, () => {
      f.fail(ctx.edit({ op: 'delete', at: at(key) }));
    });
    const line = h(f.doc, 'div', { class: 'sw-list-item' }, [name, input, remove]);
    return { el: h(f.doc, 'div', { class: 'sw-secret-entry' }, [line, warning]), name, input, warning, remove };
  };

  const sync = (value: YamlValue): void => {
    current = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Readonly<Record<string, YamlValue>>) : {};
    const names = Object.keys(current);
    for (const [key, row] of [...rows]) {
      if (!names.includes(key)) {
        row.el.remove();
        rows.delete(key);
      }
    }
    names.forEach((key, i) => {
      let row = rows.get(key);
      if (!row) {
        row = makeRow(key);
        rows.set(key, row);
      }
      if (f.items.children[i] !== row.el) f.items.insertBefore(row.el, f.items.children[i] ?? null);
      const raw = current[key];
      const decoded = typeof raw === 'string' ? decode(raw) : undefined;
      // A textarea reports "\r\n" as "\n", so text with a carriage return could not be written back unchanged.
      const lossy = decoded !== undefined && decoded.includes('\r');
      const shown = decoded ?? (raw === null || raw === undefined || typeof raw === 'object' ? '' : String(raw));
      if (row.input.value !== shown) row.input.value = shown;
      const invalid = decoded === undefined || lossy;
      row.input.readOnly = invalid;
      row.input.rows = Math.min(Math.max(shown.split('\n').length, 1), 10);
      row.warning.textContent = decoded === undefined ? ui.secretInvalidBase64 : lossy ? ui.secretCarriageReturn : '';
      row.warning.hidden = !invalid;
      row.name.textContent = key;
      row.input.setAttribute('aria-label', `${ctx.label}, ${key}, ${ui.entryValue}`);
      if (invalid) row.input.setAttribute('aria-describedby', row.warning.id);
      else row.input.removeAttribute('aria-describedby');
      row.input.disabled = readOnlyNow;
      row.remove.disabled = readOnlyNow;
    });
  };
  sync(ctx.value);
  return {
    el: f.el,
    update(value, readOnly) {
      readOnlyNow = readOnly;
      sync(value);
    },
    focus: () => (rows.values().next().value?.input ?? f.el).focus(),
  };
};
