import { describeNode } from '../document/describe.js';
import { getNode } from '../document/paths.js';
import type { DocumentStore, StoreEvent } from '../document/store.js';
import type { NodeRef, ParsedText, TextRange } from '../document/types.js';
import type { CodeEditorAdapter } from '../editors/adapter.js';
import { kindKey } from '../formats/guide.js';
import type { FormatDefinition, Guide, SchemaBundle } from '../formats/types.js';
import type { SchemaMessages } from '../validation/messages.js';
import type { Problem } from '../validation/problems.js';
import { loadBuiltinFormats } from './formats.js';
import type { UiMessages } from './messages.js';
import type { VariableStore } from './variables.js';
import type { VariableDecl } from '../formats/types.js';

/**
 * What every pane and feature of the editor shares.
 * @internal
 */
export interface EditorContext {
  /** The one document store. */
  readonly store: DocumentStore;
  /** Resolved UI and schema messages. */
  readonly messages: { readonly ui: UiMessages; readonly schema: Partial<SchemaMessages> };
  /** The resolved format; `undefined` while none is resolved. */
  format(): FormatDefinition | undefined;
  /** The format's guide with the host override merged in; empty without a format. */
  guide(): Guide;
  /** Whether the user is blocked from editing. */
  readOnly(): boolean;
  /** The current problems. */
  problems(): readonly Problem[];
  /** The loaded schema bundle for document `doc`, if already loaded. */
  bundleFor(doc: number): SchemaBundle | undefined;
  /**
   * Loads the schema bundle for document `doc`; `undefined` for an unknown kind, a failed load or
   * after destroy. Never rejects. A loaded bundle is cached (per kind, until the format changes);
   * a failed load is recorded in {@link bundleError} and tried again by the next call.
   */
  loadBundle(doc: number): Promise<SchemaBundle | undefined>;
  /** The error from the last failed schema load for document `doc`, or `undefined` (never loaded, loaded, or unknown kind). */
  bundleError(doc: number): unknown;
  /** Scrolls the code editor to `r` and selects it, without changing the mode (the outline and the problems panel follow along). */
  revealRange(r: TextRange): void;
  /**
   * Takes the user to `r` in the code: in Visual mode, switches to Split first (firing
   * `onModeChange`); then selects `r` and focuses the code editor. Every "Edit in code" and "Jump
   * to error" control uses this.
   */
  editInCode(r: TextRange): void;
  /** Reveals `ref` in the panes. */
  select(ref: NodeRef): void;
  /** Selects `ref` in the visual pane, waits for its schema, then focuses the field's widget (nothing happens in code mode). */
  focusField(ref: NodeRef): void;
  /** Subscribes to problem changes; returns an unsubscribe function. */
  onProblems(fn: (problems: readonly Problem[]) => void): () => void;
  /** The variable store; `undefined` while the format has no `variables`. */
  variables(): VariableStore | undefined;
  /** Subscribes to changes of the declarations (including the host's `setVariables`); returns an unsubscribe function. */
  onVariables(fn: (decls: readonly VariableDecl[]) => void): () => void;
  /** Applies the quick fix of `problem`; false when it has none, the editor is read-only, or an edit is refused. */
  applyFix(problem: Problem): boolean;
}

/**
 * One pane of the editor body (code, visual).
 * @internal
 */
export interface Pane {
  /** The pane's root element. */
  readonly el: HTMLElement;
  /** Called after every store change; `null` asks for a full re-sync (for example after the format changes). */
  update(e: StoreEvent | null): void;
  /** Reveals `ref`; false when the pane cannot. */
  reveal(ref: NodeRef): boolean;
  /** Blocks or allows user edits. */
  setReadOnly(readOnly: boolean): void;
  /** Releases the pane. */
  destroy(): void;
}

/**
 * Lazy loaders, replaceable in tests.
 * @internal
 */
export const loaders = {
  /** Loads the CodeMirror adapter on demand. */
  async loadDefaultAdapter(): Promise<CodeEditorAdapter> {
    const m = await import('../editors/codemirror/index.js');
    return m.codemirrorAdapter();
  },
  /** Loads the built-in formats on demand. */
  loadBuiltinFormats(): Promise<FormatDefinition[]> {
    return loadBuiltinFormats();
  },
};

/** The source range to reveal for `ref`: its key when it has one, else its value. */
export function rangeForRef(parsed: ParsedText, ref: NodeRef): TextRange | undefined {
  const v = describeNode(parsed, ref);
  return v ? (v.keyRange ?? v.range) : undefined;
}

/** The cache key of document `doc`'s schema: the kind key for `documents` formats, the format id for `mapping` ones. */
function bundleKey(format: FormatDefinition, parsed: ParsedText, doc: number): string | undefined {
  if (format.rootModel === 'mapping') return format.id;
  const str = (field: string): string | undefined => {
    try {
      const n = getNode(parsed, { doc, path: [field] }) as { value?: unknown } | undefined;
      return typeof n?.value === 'string' ? n.value : undefined;
    } catch {
      return undefined;
    }
  };
  const apiVersion = str('apiVersion');
  const kind = str('kind');
  return apiVersion !== undefined && kind !== undefined ? kindKey(apiVersion, kind) : undefined;
}

/**
 * The schema bundle cache behind `bundleFor` and `loadBundle`. Entries are keyed by kind (or by
 * format id); the cache is cleared when the format changes, and nothing is stored after `isDestroyed`.
 * @internal
 */
export function createBundleCache(deps: {
  store: DocumentStore;
  format: () => FormatDefinition | undefined;
  isDestroyed: () => boolean;
}): Pick<EditorContext, 'bundleFor' | 'loadBundle' | 'bundleError'> & { clear(): void } {
  const loaded = new Map<string, SchemaBundle | undefined>();
  const errors = new Map<string, unknown>();
  const pending = new Map<string, Promise<SchemaBundle | undefined>>();
  const parsedNow = (): ParsedText => (deps.store.parsed.ok ? deps.store.parsed : (deps.store.lastGood ?? deps.store.parsed));
  const keyOf = (doc: number): string | undefined => {
    const f = deps.format();
    return f ? bundleKey(f, parsedNow(), doc) : undefined;
  };
  return {
    bundleFor(doc) {
      const key = keyOf(doc);
      return key === undefined ? undefined : loaded.get(key);
    },
    bundleError(doc) {
      const key = keyOf(doc);
      return key === undefined ? undefined : errors.get(key);
    },
    async loadBundle(doc) {
      const format = deps.format();
      const key = keyOf(doc);
      if (!format || key === undefined || deps.isDestroyed()) return undefined;
      if (loaded.has(key)) return loaded.get(key);
      let p = pending.get(key);
      if (!p) {
        let load: Promise<SchemaBundle | undefined>;
        try {
          load = Promise.resolve(format.loadSchema(parsedNow(), doc));
        } catch (err) {
          load = Promise.reject(err);
        }
        p = load.then(
          (bundle) => {
            // A load that finishes after destroy or a format change must not be cached.
            if (!deps.isDestroyed() && deps.format() === format) {
              loaded.set(key, bundle);
              errors.delete(key);
            }
            return bundle;
          },
          (err: unknown) => {
            if (!deps.isDestroyed() && deps.format() === format && !errors.has(key)) {
              console.error(`stack-weaver: loading the schema for "${key}" failed`, err);
            }
            if (!deps.isDestroyed() && deps.format() === format) errors.set(key, err);
            return undefined;
          },
        );
        pending.set(key, p);
        void p.finally(() => pending.delete(key));
      }
      const bundle = await p;
      return deps.isDestroyed() ? undefined : bundle;
    },
    clear() {
      loaded.clear();
      errors.clear();
      pending.clear();
    },
  };
}
