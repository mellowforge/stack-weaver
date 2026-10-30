import type { FormatDefinition } from '../formats/types.js';
import type { Problem } from '../validation/problems.js';
import { validateText } from '../validation/validate.js';
import type { EditorContext } from './context.js';
import type { UiMessages } from './messages.js';

/** How long after the last change validation runs, in milliseconds. */
export const VALIDATION_DELAY_MS = 150;

/** The text of the problem count, such as "2 problems". */
export function problemCountText(ui: UiMessages, count: number): string {
  if (count === 0) return ui.problemsNone;
  return count === 1 ? ui.problemsOne : ui.problemsMany.replace('{count}', String(count));
}

/** Enough of a problem to tell whether the list changed. */
function signature(problems: readonly Problem[]): string {
  return JSON.stringify(problems.map((p) => [p.severity, p.code, p.message, p.doc, p.from, p.to]));
}

// Used while no format is resolved: it can report YAML syntax problems, and nothing else.
const NO_FORMAT: FormatDefinition = {
  id: '',
  label: '',
  version: '',
  rootModel: 'mapping',
  detect: () => false,
  kinds: () => [],
  loadSchema: () => Promise.resolve(undefined),
  guide: { groups: [], kinds: {}, fields: {} },
};

/**
 * Validates the current text, with schemas coming through the editor's bundle cache. A failed
 * load surfaces as the `schema.unavailable` error that `validateText` reports for a rejected load.
 */
async function validateCurrent(ctx: EditorContext): Promise<Problem[]> {
  const format = ctx.format();
  const parsed = ctx.store.parsed;
  if (!format) return parsed.ok ? [] : validateText(parsed, NO_FORMAT, { messages: ctx.messages.schema });
  const cached: FormatDefinition = {
    ...format,
    async loadSchema(_p, doc) {
      const bundle = await ctx.loadBundle(doc);
      const failure = ctx.bundleError(doc);
      if (failure !== undefined) throw failure;
      return bundle;
    },
  };
  return validateText(parsed, cached, { messages: ctx.messages.schema });
}

/**
 * Runs validation {@link VALIDATION_DELAY_MS} after the last change and publishes the result.
 * Every run takes a sequence number; a result is published only if no later run started and the
 * text is still the one it validated, so a slow older run can never overwrite a newer one.
 * @internal
 */
export interface ProblemScheduler {
  /**
   * (Re)starts the debounce timer, making any run in flight stale; except that a run already in
   * flight for the current text is kept, and nothing is scheduled.
   */
  schedule(): void;
  /**
   * Validates now. Resolves once this run is done: its problems published, or found unchanged
   * (nothing to publish), or dropped because a later run started or the text changed.
   */
  run(): Promise<void>;
  /** Cancels the timer and drops any run in flight. */
  destroy(): void;
}

/** Creates the scheduler; `publish` receives the problems of the latest run, only when they changed. */
export function createProblemScheduler(ctx: EditorContext, publish: (problems: readonly Problem[]) => void): ProblemScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let current = '[]';
  let destroyed = false;
  /** The latest run while it is in flight, with the text it validates. */
  let inFlight: { seq: number; text: string } | undefined;

  const run = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const mine = ++seq;
    const text = ctx.store.text;
    inFlight = { seq: mine, text };
    let result: Problem[];
    try {
      result = await validateCurrent(ctx);
    } catch (err) {
      // validateText does not reject; this guards the cache wrapper around it.
      console.error('stack-weaver: validation failed', err);
      return;
    } finally {
      if (inFlight?.seq === mine) inFlight = undefined;
    }
    if (destroyed || mine !== seq || ctx.store.text !== text) return;
    const sig = signature(result);
    if (sig === current) return;
    current = sig;
    publish(result);
  };

  return {
    schedule() {
      if (destroyed) return;
      // A run for this very text has just started (a format change validates at once, inside the
      // same store change): it is current, so it stays, and no second run is needed.
      if (inFlight !== undefined && inFlight.seq === seq && inFlight.text === ctx.store.text) return;
      clearTimeout(timer);
      seq++; // a run for the previous text, still in flight, is now stale
      timer = setTimeout(() => void run(), VALIDATION_DELAY_MS);
    },
    run,
    destroy() {
      destroyed = true;
      clearTimeout(timer);
    },
  };
}
