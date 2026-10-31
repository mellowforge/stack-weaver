import type { EditOp } from '../document/edit.js';
import type { DocumentStore } from '../document/store.js';
import type { FormatDefinition, VariableDecl } from '../formats/types.js';
import type { Problem } from '../validation/problems.js';
import { deepFreeze } from '../formats/freeze.js';
import { checkDecl } from '../variables/decl.js';

/**
 * Where declarations live: in the document's variables block, or in a list the host owns.
 *
 * `'x-variables'` names the block of the format's `FormatVariables.key`, whatever that key is
 * (`x-variables` for compose); validation then sees `variableSource: 'document'`. `'external'`
 * keeps `value` (copied) outside the text; validation then sees `variableSource: 'host'`.
 */
export type VariablesOption =
  | { readonly store: 'x-variables' }
  | { readonly store: 'external'; readonly value: readonly VariableDecl[] };

/** Where declarations live; the editor creates one per instance. */
export interface VariableStore {
  /**
   * `'x-variables'` for the block in the document (the one named by the format's
   * `FormatVariables.key`), `'external'` for the host's list. See {@link VariablesOption}.
   */
  readonly kind: 'x-variables' | 'external';
  /**
   * The current declarations, deep-frozen (for `x-variables`, from the last good parse while the
   * text is broken).
   */
  get(): readonly VariableDecl[];
  /** Adds or replaces (by `replaces ?? decl.name`); false when refused (read-only, invalid, name taken, edit refused), changing nothing. */
  set(decl: VariableDecl, replaces?: string): boolean;
  /** Removes the declaration named `name`; false, changing nothing, when there is none, the editor is read-only, or the edit is refused. */
  remove(name: string): boolean;
}

/** Throws a `TypeError` unless `decls` are all valid and their names are unique. */
function assertDecls(decls: readonly VariableDecl[]): void {
  const seen = new Set<string>();
  for (const d of decls) {
    const bad = checkDecl(d);
    if (bad) throw new TypeError(`stack-weaver: invalid variable declaration "${String(d?.name)}" (${bad})`);
    if (seen.has(d.name)) throw new TypeError(`stack-weaver: duplicate variable "${d.name}"`);
    seen.add(d.name);
  }
}

const copy = (d: VariableDecl): VariableDecl => ({ ...d, ...(d.enumValues ? { enumValues: [...d.enumValues] } : {}) });
/** Copies of `decls`, deep-frozen: the host's list and the editor's state never share an object. */
const frozenCopies = (decls: readonly VariableDecl[]): readonly VariableDecl[] => deepFreeze(decls.map(copy));

/**
 * The editor's variable state.
 * @internal
 */
export interface Variables {
  /** The store, or `undefined` while the format has no `variables`. */
  store(): VariableStore | undefined;
  /** The declarations, whatever the format. */
  get(): readonly VariableDecl[];
  /** Replaces the host's list (external only; warns otherwise). A `TypeError` for invalid declarations. */
  setAll(decls: readonly VariableDecl[]): void;
  /** Subscribes to changes (including `setAll`); returns an unsubscribe function. */
  on(fn: (decls: readonly VariableDecl[]) => void): () => void;
  /** Notifies if the declarations changed since the last look; does nothing while a batch of edits runs. */
  check(): void;
  /** Takes the current declarations as seen, without notifying. */
  reseed(): void;
  /**
   * Applies the fix of `problem`, all of it or nothing; false when there is none or it was refused
   * (a declaration fix for a name that is already declared is refused).
   */
  applyFix(problem: Problem): boolean;
  /** Drops the listeners. */
  destroy(): void;
}

/**
 * Creates the variable state of one editor. Throws a `TypeError` for invalid initial declarations.
 * @internal
 */
export function createVariables(deps: {
  option: VariablesOption | undefined;
  store: DocumentStore;
  format: () => FormatDefinition | undefined;
  readOnly: () => boolean;
  isDestroyed: () => boolean;
  /** Reports a change to the host's `onVariablesChange`. */
  onChange: (decls: readonly VariableDecl[]) => void;
  /** Validates at once, after a change the text-only staleness guard cannot see. */
  revalidate: () => void;
}): Variables {
  const { store } = deps;
  const kind = deps.option?.store ?? 'x-variables';
  let external: readonly VariableDecl[] = [];
  if (deps.option?.store === 'external') {
    assertDecls(deps.option.value);
    external = frozenCopies(deps.option.value);
  }
  const listeners = new Set<(d: readonly VariableDecl[]) => void>();
  let groupN = 0;
  let hold = 0;

  const fv = () => deps.format()?.variables;
  /** The declarations, deep-frozen (a fresh read of the block each time for `x-variables`). */
  const get = (): readonly VariableDecl[] => {
    if (kind === 'external') return external;
    const f = fv();
    return deepFreeze(f ? f.read(store.parsed.ok ? store.parsed : (store.lastGood ?? store.parsed)) : []);
  };
  const sigOf = (d: readonly VariableDecl[]): string => JSON.stringify(d);
  let last = sigOf(get());

  const emit = (host: boolean): void => {
    if (deps.isDestroyed()) return;
    const decls = get();
    for (const fn of [...listeners]) {
      if (deps.isDestroyed()) return; // a listener may have destroyed the editor
      try {
        fn(decls);
      } catch (err) {
        console.error('stack-weaver: a variables callback threw', err);
      }
    }
    if (host && !deps.isDestroyed()) deps.onChange(decls);
  };
  const check = (): void => {
    if (hold > 0) return;
    const sig = sigOf(get());
    if (sig === last) return;
    last = sig;
    emit(true);
    if (kind === 'external') deps.revalidate();
  };
  /**
   * Applies `ops` all or nothing through {@link DocumentStore.transact}, as one undo step; listeners
   * hear of the net change once, so no subscriber, such as the visual pane, ever sees an
   * intermediate text (where a declaration can be invalid between two ops).
   */
  const applyOps = (ops: readonly EditOp[], prefix: string): boolean => {
    hold++;
    try {
      return store.transact(ops, { group: `${prefix}:${++groupN}` }).ok;
    } finally {
      hold--;
      check();
    }
  };

  const names = (): readonly string[] => get().map((d) => d.name);
  const vstore: VariableStore = {
    kind,
    get,
    set(decl, replaces) {
      if (deps.isDestroyed() || deps.readOnly() || checkDecl(decl)) return false;
      const target = replaces ?? decl.name;
      const taken = names();
      if (replaces !== undefined && !taken.includes(replaces)) return false;
      if (decl.name !== target && taken.includes(decl.name)) return false;
      if (kind === 'external') {
        external = deepFreeze(taken.includes(target) ? external.map((d) => (d.name === target ? copy(decl) : d)) : [...external, copy(decl)]);
        check();
        return true;
      }
      const f = fv();
      if (!f || !store.parsed.ok) return false;
      const ops = f.writeOps(store.parsed, decl, replaces);
      return ops !== undefined && applyOps(ops, 'variables');
    },
    remove(name) {
      if (deps.isDestroyed() || deps.readOnly() || !names().includes(name)) return false;
      if (kind === 'external') {
        external = Object.freeze(external.filter((d) => d.name !== name));
        check();
        return true;
      }
      const f = fv();
      if (!f || !store.parsed.ok) return false;
      return applyOps(f.removeOps(store.parsed, name), 'variables');
    },
  };
  const current = (): VariableStore | undefined => (fv() ? vstore : undefined);

  return {
    store: current,
    get,
    setAll(decls) {
      if (deps.isDestroyed()) return;
      if (kind !== 'external') {
        console.warn('stack-weaver: setVariables has no effect with variables: { store: "x-variables" }; the declarations live in the document');
        return;
      }
      assertDecls(decls);
      external = frozenCopies(decls);
      last = sigOf(external);
      emit(false); // the host asked for this: no onVariablesChange echo
      deps.revalidate();
    },
    on(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    check,
    reseed() {
      last = sigOf(get());
    },
    applyFix(problem) {
      const action = problem.fix?.action;
      if (!action || deps.isDestroyed() || deps.readOnly()) return false;
      // A fix declares; it never replaces a declaration made since the problem was found.
      if (action.kind === 'declareVariable') return !names().includes(action.decl.name) && (current()?.set(action.decl) ?? false);
      return applyOps(action.ops, 'fix');
    },
    destroy() {
      listeners.clear();
    },
  };
}
