import type { EditOp, EditRefusal } from '../document/edit.js';
import type { DocumentStore } from '../document/store.js';
import type { FormatDefinition, VariableDecl } from '../formats/types.js';
import type { Problem } from '../validation/problems.js';
import { deepFreeze } from '../formats/freeze.js';
import { validateVariableDecl } from '../variables/decl.js';

/**
 * Why a variable or fix action was refused: `no-fix` (the problem has no fix), `read-only` and
 * `destroyed` (the editor), `unavailable` (the format has no variables, the text does not parse,
 * or the format could not write the change), `invalid` (the declaration fails validation),
 * `name-taken` (a rename onto an existing name), `not-found` (no such declaration),
 * `already-declared` (a declaration fix for a name that is already declared) and `edit-refused`
 * (the text edit was refused; see {@link ActionResult.edit}).
 */
export type ActionRefusal =
  | 'no-fix'
  | 'read-only'
  | 'destroyed'
  | 'unavailable'
  | 'invalid'
  | 'name-taken'
  | 'not-found'
  | 'already-declared'
  | 'edit-refused';

/** The result of a refusable editor action: done, or refused with a reason (and, for `edit-refused`, the edit's own reason in `edit`). Nothing changes when refused. */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: ActionRefusal; readonly edit?: EditRefusal };

const OK: ActionResult = Object.freeze({ ok: true });
const refuse = (reason: ActionRefusal): ActionResult => ({ ok: false, reason });

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
  /**
   * Adds or replaces (by `replaces ?? decl.name`). Refused, changing nothing, with `read-only`,
   * `destroyed`, `invalid`, `not-found` (`replaces` names no declaration), `name-taken`,
   * `unavailable` or `edit-refused`.
   */
  set(decl: VariableDecl, replaces?: string): ActionResult;
  /** Removes the declaration named `name`. Refused, changing nothing, with `read-only`, `destroyed`, `not-found`, `unavailable` or `edit-refused`. */
  remove(name: string): ActionResult;
}

/** Throws a `TypeError` unless `decls` are all valid and their names are unique. */
function assertDecls(decls: readonly VariableDecl[]): void {
  const seen = new Set<string>();
  for (const d of decls) {
    const bad = validateVariableDecl(d);
    if (bad) throw new TypeError(`stack-weaver: invalid variable declaration "${String(d?.name)}" (${bad})`);
    if (seen.has(d.name)) throw new TypeError(`stack-weaver: duplicate variable "${d.name}"`);
    seen.add(d.name);
  }
}

const copy = (d: VariableDecl): VariableDecl => (d.type === 'enum' ? { ...d, enumValues: [...d.enumValues] } : { ...d });
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
   * Applies the fix of `problem` to the current text (its ops address nodes by path), all of it or
   * nothing. Refused with `no-fix`, `read-only`, `destroyed`, `already-declared` (a declaration fix
   * for a name that is already declared), `unavailable` or `edit-refused`.
   */
  applyFix(problem: Problem): ActionResult;
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
  const applyOps = (ops: readonly EditOp[], prefix: string): ActionResult => {
    hold++;
    try {
      const r = store.transact(ops, { group: `${prefix}:${++groupN}` });
      return r.ok ? OK : { ok: false, reason: 'edit-refused', edit: r.reason };
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
      if (deps.isDestroyed()) return refuse('destroyed');
      if (deps.readOnly()) return refuse('read-only');
      if (validateVariableDecl(decl)) return refuse('invalid');
      const target = replaces ?? decl.name;
      const taken = names();
      if (replaces !== undefined && !taken.includes(replaces)) return refuse('not-found');
      if (decl.name !== target && taken.includes(decl.name)) return refuse('name-taken');
      if (kind === 'external') {
        external = deepFreeze(taken.includes(target) ? external.map((d) => (d.name === target ? copy(decl) : d)) : [...external, copy(decl)]);
        check();
        return OK;
      }
      const f = fv();
      if (!f || !store.parsed.ok) return refuse('unavailable');
      const ops = f.writeOps(store.parsed, decl, replaces);
      return ops === undefined ? refuse('unavailable') : applyOps(ops, 'variables');
    },
    remove(name) {
      if (deps.isDestroyed()) return refuse('destroyed');
      if (deps.readOnly()) return refuse('read-only');
      if (!names().includes(name)) return refuse('not-found');
      if (kind === 'external') {
        external = Object.freeze(external.filter((d) => d.name !== name));
        check();
        return OK;
      }
      const f = fv();
      if (!f || !store.parsed.ok) return refuse('unavailable');
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
      if (!action) return refuse('no-fix');
      if (deps.isDestroyed()) return refuse('destroyed');
      if (deps.readOnly()) return refuse('read-only');
      // A fix declares; it never replaces a declaration made since the problem was found.
      if (action.kind === 'declareVariable') {
        if (names().includes(action.decl.name)) return refuse('already-declared');
        const vs = current();
        return vs ? vs.set(action.decl) : refuse('unavailable');
      }
      return applyOps(action.ops, 'fix');
    },
    destroy() {
      listeners.clear();
    },
  };
}
