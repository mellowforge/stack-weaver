# Plan 1 (headless core): carried-forward follow-ups

These are decisions and deferred work from the Plan 1 execution and its milestone review, which used the pr-review-toolkit panel. Later plans must pick them up.

## Plan 2: start with an "API hardening" task
The type-design reviewer proposed these. They were deferred because packages are 0.x and unpublished, so breaking changes are still free. Design them against Plan 2's real needs:
- **Decouple `yaml` from the public API.** Add a `describeNode(p, ref)` read view, and make `FormatDefinition.detect` and `loadSchema` take plain data. If that isn't done, re-export the yaml guards from core and change the signature to `toData(p, doc)`.
- **`DocumentStore`:**
  - transactions or grouped visual edits (`transact`, or `edit(ops[])`), plus an `'api'` origin for `edit`;
  - `reset(text)` and `clearHistory()`.
- **`GuideOverride` type** for `mergeGuide`, which should drop incomplete merged entries. Replace `GuideField.recommended` and `advanced` with `tier`.
- **Mutability:** use `readonly` throughout the public types, and `Object.freeze` the exported formats and guides. `ResolvedSchema` must not alias cached bundle internals.
- **Name the inline types:** `GuideGroup`, `GuideKind`, `KindCatalog`, `Position`, `ProblemSource`, `EditOrigin`. Add a shared `TextRange`, and consider replacing `YamlProblem` with `Problem`.
- **One kind key format** (`KindEntry.id` against the guide's `apiVersion/Kind`), or export a `kindKey()` helper.
- **Edit operations:** add a `deleteDocument` op. Have `EditResult` return `parsed` and the ref of the created node.
- **Subpath exports:** trim the duplicates of format methods (`loadKubernetesKind`, `kubernetesKinds`, `loadComposeSchema`).
- **Spec wording:** update `messages?: Partial<Messages>` in the spec's Host API. Schema messages are now `SchemaMessages`, and UI strings need their own type.
- **UI behaviour the engine leaves to Plan 2:**
  - free-form-key objects (labels, annotations, compose `services`) return no addables, so the key-value widget must offer "add key";
  - the sequence item label is the fixed string "Item";
  - `set` on an anchored scalar changes every alias of it, so the UI should explain this.

## Plan 4 (wrappers and release)
- **Changesets:** restore `.changeset/config.json` `fixed: [["@stack-weaver/core","@stack-weaver/angular","@stack-weaver/react"]]` when the wrappers are added. It is set to `[]` until then.
- **`@changesets/cli`:** kept at ^2.31.1 to match grid-master. Revisit ^3 there.

## Parked, low priority
- `--update-lock` and the first real schema bump: the lock-writing glue (`writeLockEntry`, the generators' flag branches) has only been tested with mocks. Expect to debug it on the first upstream bump.
- `parseText`'s dangling-alias check costs O(aliases × nodes).
- `add`/`push`/`delete` refuse on documents with more than 100 alias expansions. Those edits go to "edit in code".
- Deleting a pair whose value has comments between items is refused ("edit in code"), not restructured.
- Remaining per-task minors (kept in the SDD ledger at the time):
  - `edit.ts` size and helper split;
  - store listener exceptions and re-entrancy semantics;
  - generator rmSync and parallel-run race;
  - no-op int32/int64/double/byte formats;
  - lenient quantity regex;
  - entry-walk regex duplicated between `check-entry.mjs` and the test;
  - weak cycle assertion in `resolve.test.ts`;
  - a single resolve per property in `addableAt` (O(props × depth)).
