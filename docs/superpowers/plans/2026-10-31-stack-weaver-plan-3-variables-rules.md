# stack-weaver Plan 3: Compose Variables and Semantic Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two features:
- **Typed compose variables:** declarations, two pluggable stores, `${VAR}` substitution before schema checks, a "Use variable" toggle and a Variables section.
- **Semantic lint rules as format plugins:** four Kubernetes rules plus the compose variable rules, with quick fixes in every view.

**Architecture:**
- **Engine:** the headless engine (`validateText`) gains two format hooks.
  - `FormatDefinition.variables` substitutes placeholders and names the paths whose schema errors are dropped.
  - `FormatDefinition.rules` runs cross-document checks after schema validation.
  - Each rule returns path-based findings, and the engine turns them into ranged `Problem`s. A `Problem` may carry a plain-data `fix`.
- **Where the code lives:** all compose and Kubernetes code lives in the lazily loaded format subpaths. The entry gets types, the dispatch, a small `variables/` module (type fit, variable store) and the UI.
- **Editor:** it owns a `VariableStore`. The store is either the document's `x-variables:` block (edited through the document store, so one undo history) or host-held declarations (`external`, reported through `onVariablesChange`).

**Tech Stack:** TypeScript ^7.0.2, `yaml` v2, ajv (precompiled), CodeMirror 6 (`@codemirror/lint` `Diagnostic.actions`), Vitest ^5.0.5 + happy-dom ^21.0.4, pnpm 12.11.2, Node 22.

**Spec:** `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`. The relevant sections are "Validation pipeline" (item 3), "Compose variables", "Formats as data" and "Host API". Plans 1 and 2 are merged on `main`. Open follow-ups are in `docs/superpowers/notes/2026-10-30-plan-1-followups.md`. Its "Plan 4: API hardening" items stay in Plan 4: do not reshape `WidgetContext`, the adapter or the controller here beyond the additive fields this plan names.

## Global Constraints

- **Plans 1 and 2 still apply:**
  - edits never reformat untouched lines;
  - CRLF and indentation are preserved;
  - offsets are UTF-16;
  - every public export has TSDoc;
  - validating 1,000 lines takes under 50 ms (rules included);
  - never set `innerHTML` with document, guide, recipe or host strings;
  - classes are `sw-*` and custom properties `--sw-*`;
  - WCAG 2.2 AA;
  - one undo history (the store's);
  - UI strings go in `UiMessages` with defaults in `defaultUiMessages`.
- **Entry graph:** the static import graph of `dist/index.js` must not reach `generated/`, `formats/kubernetes/`, `formats/compose/`, `editors/`, `@codemirror/*` or `@lezer/*`.
  - Placeholder parsing, substitution, the `x-variables` reader and writer, and every rule live under `formats/compose/` or `formats/kubernetes/`.
  - The entry reaches them only through `FormatDefinition.variables` / `.rules`.
  - `node scripts/check-entry.mjs` (in `packages/core`) must pass after every task.
- **Spec values, verbatim:**
  - `VariableDecl` is `{ name, type: 'string' | 'number' | 'boolean' | 'port' | 'enum', enumValues?, default?, description? }`.
  - The editor writes **bare `${VAR}`** and never an inline default.
  - Hand-written `${VAR:-x}` is kept as-is.
  - The output never has values resolved into it.
- **Host API (spec, Plan 3 rows):**
  - `variables?: { store: 'x-variables' } | { store: 'external'; value: VariableDecl[] }`;
  - `onVariablesChange?(decls)`.
- **Problem sources:** rule problems have `source: 'rule'` and `code: 'rule.<id>'`. Rule messages go through the same message table as schema messages, so hosts can translate them through `messages.schema`.
- **Out of scope:**
  - wrappers, `site/` and publishing (Plan 4);
  - the Plan 4 API-hardening list;
  - rewriting references when a variable is renamed (see D6);
  - `matchExpressions` evaluation (D7).

## Decisions (rulings made while planning; each is the plan's authority)

- **D1. A placeholder with no default.** Spec: "checked by its declared type only".
  - The value stays `${VAR}` in the data, and every schema error at that exact path is dropped.
  - The rule `variable-type` then reports a declared type that does not fit the field's schema types.
  - A sentinel value is not used: none survives `pattern` fields.
  - *Cost if wrong:* a stricter reading would need a sentinel later. That change is additive.
- **D2. The `x-variables` block** is a mapping from name to entry: `{ type, default?, enum?, description? }`. `enum` holds a YAML list of strings and maps to `enumValues`.

  ```yaml
  x-variables:
    WEB_PORT: { type: port, default: 8080, description: Public port }
    STAGE: { type: enum, enum: [dev, prod], default: dev }
  ```
- **D3. Which store, and which formats.**
  - The default store is `{ store: 'x-variables' }`.
  - Variables exist only for formats with `FormatDefinition.variables` (compose).
  - For Kubernetes, the toggle, the Variables section, substitution and variable rules are all absent.
- **D4. The Variables section** is synthetic for both stores. It is an outline root named "Variables" (first in the outline), backed by editor state rather than a `NodeRef`. Under the `x-variables` store, the `x-variables` key itself is hidden from the generic outline.
- **D5. Variable API semantics.**
  - **`onVariablesChange`** fires whenever the effective declarations change. That includes edits in the Variables section, a quick fix, and text edits of the block under `x-variables`. It does not fire for `setVariables`.
  - **`setVariables`** works only with the `external` store. Under `x-variables` it is a no-op with `console.warn`.
  - **Invalid host declarations** (passed to the `variables.value` option or to `setVariables`) throw `TypeError`. Invalid means a bad name, a duplicate name, an unknown type, an `enum` with no values, or a default of the wrong type.
- **D6. Renaming** a variable changes its declaration only. References become undeclared and show the warning, with its fix.
- **D7. Kubernetes rule scope.**
  - Selector rules read `matchLabels` only.
  - A workload with no `selector` and a Service with no `selector` produce no finding.
  - "Workloads" means Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob and Pod.
  - `missing-resources` checks `containers`, not `initContainers`.
- **D8. Scanning and severities.**
  - **What is scanned:** values only, never keys. The `x-variables` block itself is never scanned or substituted.
  - **`undeclared-variable`** also fires for `${VAR:-x}`: an inline default does not count as a declaration.
  - **Severities:**

    | Severity | Rules |
    | --- | --- |
    | error | `selector-mismatch`, `variable-declaration`, `variable-type`, `rule.failed` |
    | warning | `service-selector`, `target-port`, `missing-resources`, `undeclared-variable`, `variable-default` |
- **D9. Union field types** in compose (`["boolean","string"]`, `["integer","string"]`, `["number","string"]`) exist for interpolation.
  - `pickWidget` treats such a list as the non-string type.
  - Type fit (the toggle list and `variable-type`) ignores the `string` member of such a list.
  - A typed widget never shows a non-placeholder string: that row falls back to read-only text.

## Review Focus

1. **`$$` escapes:** `$$`, `$${VAR}` and `$$VAR` are literal text. They are not placeholders, so no undeclared warning and no substitution. Test in Task 2.
2. **CRLF text:** a placeholder in a CRLF document gets a problem range that covers exactly `${NAME}`, also inside quoted scalars. Test in Task 4.
3. **Multiple and cross-namespace workloads:** a Service whose selector matches one of two workloads gets no `service-selector` warning. A workload in another namespace does not count. `targetPort` names are looked up in every matched workload. Tests in Task 5.
4. **Malformed `x-variables`:** a non-mapping block, an entry that is not a mapping, an unknown `type`, an `enum` without values, and a default of the wrong type. Each gives one `variable-declaration` error at the offending node. The valid entries keep working, and nothing throws. Tests in Tasks 3 and 4.
5. **External-store revalidation:** after "Declare variable" under the `external` store, the text is unchanged, but the undeclared warning disappears without any typing. Under `x-variables`, one undo removes the whole declaration. Tests in Task 6.

---

### Task 1: Rule and variable hooks in the validation engine

**Files:**
- Modify: `packages/core/src/formats/types.ts`. Add these types: `VariableType`, `VariableDecl`, `QuickFixAction`, `QuickFix`, `RuleInput`, `RuleFinding`, `Rule` and `FormatVariables`, plus `FormatDefinition.rules?` and `.variables?`.
- Modify: `packages/core/src/validation/problems.ts`. Add `Problem.fix?`. Rewrite the `source` and `code` TSDoc: drop "'rule' is reserved… nothing reports it yet", and list `rule.<id>` and `rule.failed`.
- Modify: `packages/core/src/validation/validate.ts`
- Modify: `packages/core/src/validation/messages.ts`. Add a `rule.failed` entry with params `rule` and `cause`.
- Modify: `packages/core/src/index.ts`: export the new types.
- Test: `packages/core/test/validation/rules.test.ts`

**Interfaces:**
- Consumes: `validateText`, `toData`, `getNode`, `getPairKey`, `messageFor` (Plan 1); `EditOp` (Plan 2).
- Produces (all `readonly`, all exported from the entry):

```ts
export type VariableType = 'string' | 'number' | 'boolean' | 'port' | 'enum';
export interface VariableDecl {
  readonly name: string; readonly type: VariableType; readonly enumValues?: readonly string[];
  readonly default?: string | number | boolean; readonly description?: string;
}
export type QuickFixAction =
  | { readonly kind: 'declareVariable'; readonly decl: VariableDecl }
  | { readonly kind: 'edit'; readonly ops: readonly EditOp[] };
export interface QuickFix { readonly label: string; readonly action: QuickFixAction }
export interface RuleInput {
  readonly parsed: ParsedText;                          // always ok
  readonly data: readonly unknown[];                    // toData per doc; undefined for empty/unbuildable/skipped docs
  readonly bundles: readonly (SchemaBundle | undefined)[]; // the bundle each doc validated against
  readonly variables: readonly VariableDecl[];          // declarations in effect
  readonly variableSource: 'document' | 'host';         // where they came from
}
export interface RuleFinding {
  readonly severity: Severity; readonly doc: number; readonly path: YamlPath;
  readonly at?: 'key' | 'value';                        // default 'value'
  readonly range?: TextRange;                           // exact range; wins over path/at
  readonly params?: Readonly<Record<string, unknown>>;
  readonly fix?: { readonly key: string; readonly params?: Readonly<Record<string, unknown>>; readonly action: QuickFixAction };
}
export interface Rule {
  readonly id: string;                                  // code is `rule.${id}`
  readonly messages: Readonly<Record<string, MessageFn>>; // defaults for `rule.${id}` and every fix key it uses
  check(input: RuleInput): readonly RuleFinding[];
}
export interface FormatVariables {
  readonly key: string;                                 // the in-document block's root key ('x-variables')
  read(p: ParsedText): readonly VariableDecl[];         // valid entries only
  writeOps(p: ParsedText, decl: VariableDecl, replaces?: string): readonly EditOp[] | undefined;
  removeOps(p: ParsedText, name: string): readonly EditOp[];
  referenceOf(value: string): string | undefined;       // the name when the whole scalar is one placeholder
  reference(name: string): string;                      // '${NAME}'
  substitute(data: unknown, decls: readonly VariableDecl[]): { readonly data: unknown; readonly skip: readonly YamlPath[] };
}
// Problem gains:  readonly fix?: QuickFix;
// validateText opts gain:  variables?: readonly VariableDecl[]  (given → variableSource 'host')
```

- [ ] **Step 1: Write the failing tests** in `rules.test.ts`. Each test uses a fake `'mapping'` or `'documents'` format with an inline schema bundle.

```ts
it('maps a value finding to the value range, with code rule.<id> and source rule', …)
  // rule {id:'demo', messages:{'rule.demo': e => `bad ${e.params.x}`}} returns
  // {severity:'warning', doc:0, path:['a'], params:{x:1}} on "a: 5\n"
  // → one problem {source:'rule', code:'rule.demo', message:'bad 1', from:3, to:4, severity:'warning'}
it("at: 'key' points at the key", …)                    // from 0, to 1
it('range wins over path', …)
it('a missing path maps to the nearest existing ancestor', …)
it('host messages override rule defaults by code', …)    // opts.messages['rule.demo']
it('turns fix into Problem.fix with a label from the fix key', …)
  // fix {key:'fix.demo', params:{n:'X'}, action:{kind:'edit', ops:[]}} + messages['fix.demo'] → fix.label 'Fix X'
it('a throwing rule becomes one rule.failed error and other rules still run', …)
it('rules do not run while the text does not parse', …)
it('rules see data for every non-empty document and the loaded bundles', …)
it('variables.substitute data reaches the validator; errors at skip paths are dropped', …)
  // schema {properties:{n:{type:'integer'}}}; substitute maps '${N}'→7 and returns skip [] → no problem;
  // substitute returns skip [['n']] with data unchanged → no schema.type problem at n
it('decls come from opts.variables (variableSource host) or format.variables.read (document)', …)
it('problems from rules sort with the others by offset then severity', …)
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/validation/rules.test.ts`. Expected: FAIL, because the types and behaviour don't exist yet.

- [ ] **Step 3: Implement in `validate.ts`.**
  - `validateDocument` returns its `data` and `bundle` as well as its problems. The doc loop collects them into the per-doc arrays of `RuleInput`.
  - **Substitution:** when `format.variables` exists, the data passes through `substitute(data, decls)` before `bundle.validate`.
    - The declarations are `opts.variables ?? format.variables.read(p)`.
    - Errors whose `instancePath` equals a skip path (converted to a JSON pointer) or lies under it are removed before `collapse`.
  - **Rules:** after the loop, and only when `p.ok`, every `format.rules` entry runs inside its own try/catch.
    - A throw gives `rule.failed` (error, doc 0, root range, params `{ rule: id, cause }`).
    - Messages resolve with `{ ...rule.messages, ...opts.messages }`, using the same throwing-override fallback as today.
  - **Ranges:** finding → range is `range` if set, else (`at: 'key'` → `getPairKey`) else the node, else `nearestRange`. Reuse the existing private helpers. Don't duplicate them.

- [ ] **Step 4: Run** the new test file and then `pnpm --filter @stack-weaver/core test`. Expected: PASS. All 830 existing tests stay green.

- [ ] **Step 5: Commit**: `feat(core): rule and variable hooks in validateText`.

---

### Task 2: Compose placeholder syntax and substitution

**Files:**
- Create: `packages/core/src/formats/compose/variables/syntax.ts`
- Create: `packages/core/src/formats/compose/variables/substitute.ts`
- Test: `packages/core/test/formats/compose-variables-syntax.test.ts`

**Interfaces:**
- Consumes: `VariableDecl`, `YamlPath` (Task 1).
- Produces:

```ts
export interface Placeholder {
  readonly name: string;
  readonly start: number; readonly end: number;          // offsets in the scalar's string value
  readonly op?: ':-' | '-' | ':?' | '?' | ':+' | '+';     // absent for $VAR / ${VAR}
  readonly arg?: string;                                  // text after op, raw (may itself hold placeholders)
}
export function scanPlaceholders(value: string): readonly Placeholder[];
export function referenceOf(value: string): string | undefined;   // whole value is exactly one placeholder (any op)
export function substituteValue(value: string, decls: ReadonlyMap<string, VariableDecl>): { value: unknown; typeOnly: boolean };
export function substituteData(data: unknown, decls: readonly VariableDecl[], skipKey: string): { data: unknown; skip: YamlPath[] };
```

**Rules for the implementation:**
- **Names:** a name is `[A-Za-z_][A-Za-z0-9_]*`.
- **Escapes:** `$$` is an escaped `$` and never starts a placeholder.
- **Malformed:** a lone `$`, a `${` without a matching `}`, and `${1X}` are not placeholders. They stay literal and are not reported.
- **Nesting:** the `arg` of `${A:-${B}}` is `${B}`, with brace depth balanced.
- **Defaults:** `substituteValue` uses the default of `:-`/`-`. That is the inline arg, substituted recursively. Otherwise it uses the declared default.
- **Typing:** a value that is one whole placeholder takes the declared type.
  - `number` and `port` become numbers. A non-numeric inline default stays a string.
  - `boolean`: `true`/`false` text becomes a boolean.
  - `string` and `enum` stay strings.
- **Text around placeholders:** a placeholder inside longer text substitutes as text.
- **No default:** if any placeholder has no usable default (`:?`, `?`, `:+`, `+` or none), the result is `{ value: <original string>, typeOnly: true }`.
- **`substituteData`:**
  - It walks objects and arrays and returns new containers. It never mutates `data`.
  - It skips the root key `skipKey`.
  - It collects the path of every `typeOnly` scalar into `skip`.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each([
  ['${A}', [{ name: 'A', start: 0, end: 4 }]],
  ['$A', [{ name: 'A', start: 0, end: 2 }]],
  ['x-${A:-d}-y', [{ name: 'A', start: 2, end: 9, op: ':-', arg: 'd' }]],
  ['${A:?need A}', [{ name: 'A', start: 0, end: 12, op: ':?', arg: 'need A' }]],
  ['${A:-${B}}', [{ name: 'A', start: 0, end: 10, op: ':-', arg: '${B}' }]],
  ['$$', []], ['$${A}', []], ['$$A', []], ['$$$A', [{ name: 'A', start: 2, end: 4 }]],
  ['${', []], ['${1X}', []], ['$ 5', []], ['cost: $5', []],
])('scanPlaceholders(%j)', (s, want) => expect(scanPlaceholders(s)).toEqual(want));
it('referenceOf: whole-value placeholders only', …)  // '${A}'→'A', '${A:-x}'→'A', '$A'→'A', 'x${A}'→undefined, '$${A}'→undefined
it('typed whole substitution', …)  // port default 8080 → 8080 (number); boolean default true → true; enum 'dev' → 'dev'
it('inline default wins and is coerced to the declared type', …)  // '${P:-81}' with P:port default 80 → 81
it('undeclared with inline default substitutes the text', …)  // '${X:-a}' → 'a', typeOnly false
it('no default anywhere → typeOnly with the original string', …)  // '${P}' with P:port and no default
it('text with placeholders substitutes as text', …)  // 'img:${TAG}' TAG default '1.2' → 'img:1.2'
it('substituteData skips the declaration block and never mutates its input', …)
it('substituteData reports skip paths of typeOnly scalars, including inside sequences', …) // [['services','web','ports',0]]
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/formats/compose-variables-syntax.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both files to the rules above. Use one left-to-right scanner with brace-depth counting. Don't use a regex for nested args.
- [ ] **Step 4: Run** the same test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(compose): placeholder syntax and substitution`.

---

### Task 3: The `x-variables` block and `composeFormat.variables`

**Files:**
- Create: `packages/core/src/variables/decl.ts` (entry: `checkDecl` and `NAME_PATTERN`, shared with the editor in Task 6)
- Create: `packages/core/src/formats/compose/variables/block.ts`
- Create: `packages/core/src/formats/compose/variables/index.ts`. It exports `composeVariables: FormatVariables`.
- Modify: `packages/core/src/formats/compose/index.ts`. Add `variables: composeVariables`.
- Test: `packages/core/test/formats/compose-variables-block.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2 `referenceOf` and `substituteData`; `applyEdit` and `EditOp` (`set`, `add`, `delete`, `renameKey`).
- Produces:

```ts
export const VARIABLES_KEY = 'x-variables';
export interface DeclarationIssue { readonly name: string; readonly path: YamlPath; readonly reason: 'notMapping' | 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField' }
export function readBlock(p: ParsedText): { readonly decls: readonly VariableDecl[]; readonly issues: readonly DeclarationIssue[] };
export const composeVariables: FormatVariables;  // key VARIABLES_KEY; reference(n) = `\${${n}}`
// src/variables/decl.ts (entry; block.ts imports it, formats may import entry modules but not the reverse)
export const NAME_PATTERN: RegExp;  // /^[A-Za-z_][A-Za-z0-9_]*$/
export function checkDecl(d: VariableDecl): 'badName' | 'badType' | 'noEnumValues' | 'badDefault' | 'badField' | undefined;
```

**Rules for the implementation:**
- **Valid defaults by type:**
  - `string`: a string;
  - `number`: a finite number;
  - `boolean`: a boolean;
  - `port`: an integer from 1 to 65535;
  - `enum`: one of `enum`.
- **`enum`:** must be a non-empty list of strings when the type is `enum`, and is a `badField` otherwise.
- **Which nodes are wrong:**
  - The block not being a mapping gives `notMapping` at `['x-variables']`.
  - An entry that is not a mapping gives `notMapping` at its path.
  - A field gives a `badField` issue when it is not a string where a string is required, or is an unknown key.
- **`writeOps`:**
  - The default is written typed, so a port is written as `8080`, not `'8080'`.
  - **No block:** one `add` at the root, with key `x-variables` and value `{ NAME: entry }`.
  - **New entry:** one `add` under the block.
  - **Existing entry (`replaces ?? decl.name`):** `renameKey` when the name changed. Then `set` for each changed scalar field, `add` for each new field, and `delete` for each field that is gone. `enum` is changed by `delete` + `add`.
  - The entry's position and comments survive.
  - Returns `undefined` when the root is not a mapping.
- **`removeOps`:** `delete` of the entry. When it was the only entry, `delete` the whole block instead.

- [ ] **Step 1: Write the failing tests:**

```ts
it('reads valid entries in order and reports each malformed one once', …)
  // block with WEB_PORT(port 8080), BAD(type: colour), E(enum, no enum), N(number, default 'x'), S: 5
  // → decls [WEB_PORT]; issues badType@['x-variables','BAD','type'], noEnumValues@[…,'E'], badDefault@[…,'N','default'], notMapping@[…,'S']
it('a non-mapping block is one notMapping issue and no decls', …)
it('writeOps creates the block on a compose file without one, leaving other lines byte-identical', …)
it('writeOps adds under an existing block and writes typed defaults', …)   // "default: 8080" not "'8080'"
it('writeOps replace keeps position and comments; rename uses renameKey', …)
it('removeOps deletes the entry, and the block with its last entry', …)
it('validateText on compose: pull_policy "${PULL}" with PULL default always → no problem', …)
it('validateText on compose: PULL default bogus → schema.pattern at pull_policy', …)
it('validateText on compose: PULL declared without default → no schema problem at pull_policy', …)
```

The substitution tests must use `services.web.pull_policy`. Its schema is `type: string` with a `pattern`, so a raw `${PULL}` would fail without substitution. A `["boolean","string"]` field would pass either way and prove nothing.

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/formats/compose-variables-block.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `block.ts` and `index.ts`, and wire `composeFormat.variables`.
- [ ] **Step 4: Run** the test, then `node scripts/check-entry.mjs` in `packages/core` after `pnpm --filter @stack-weaver/core build`. Expected: PASS, with the entry graph unchanged in files.
- [ ] **Step 5: Commit**: `feat(compose): x-variables block and format variables hook`.

---

### Task 4: Compose variable rules

**Files:**
- Create: `packages/core/src/variables/fit.ts` (entry; shared with Task 9)
- Create: `packages/core/src/formats/compose/variables/rules.ts`
- Modify: `packages/core/src/formats/compose/index.ts`: `rules: composeRules`.
- Test: `packages/core/test/variables/fit.test.ts`, `packages/core/test/formats/compose-variables-rules.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `resolveAt` (Plan 1).
- Produces:

```ts
// src/variables/fit.ts
export function fieldTypes(schema: JsonSchema): ReadonlySet<'string' | 'number' | 'integer' | 'boolean'>; // D9: [T,'string'] → {T}
export function fitsField(decl: Pick<VariableDecl, 'type' | 'enumValues'>, schema: JsonSchema): boolean;
export function inferVariableType(schema: JsonSchema): VariableType;  // boolean→boolean, integer/number→number, else string
// src/formats/compose/variables/rules.ts
export const composeRules: readonly Rule[];  // ids: undeclared-variable, variable-default, variable-declaration, variable-type
```

**Fit table:**

| Variable type | Fits fields whose types include |
| --- | --- |
| `string` | `string` |
| `enum` | `string` (with a schema `enum`: every `enumValues` member must be in it) |
| `number` | `number` or `integer` |
| `port` | `integer`, `number` or `string` |
| `boolean` | `boolean` |

`fieldTypes` reads `type` (string or list), `anyOf`/`oneOf` branches, and an `enum`'s value types.

**Rules (default English messages):**

| id | Severity | Finds | Message | Fix |
| --- | --- | --- | --- | --- |
| `undeclared-variable` | warning | each placeholder whose name is not declared, `range` = the placeholder's text in the source | `Variable "{name}" is not declared.` | `fix.declare-variable`, `Declare variable {name}`, action `declareVariable` with `{ name, type: inferVariableType(field schema) }` plus the inline `:-`/`-` default coerced to that type, when there is one |
| `variable-default` | warning | an inline default (`:-`/`-`) that differs from the declared default (compared as text) | `The inline default "{inline}" differs from the declared default "{declared}" of {name}.` | — |
| `variable-declaration` | error | each `readBlock` issue, only when `variableSource` is `'document'` | `Invalid declaration of {name}: {reason}.` (the reason text per issue reason, also in `messages`) | — |
| `variable-type` | error | a whole-value placeholder of a declared variable whose type does not `fitsField` the field schema (from `resolveAt(bundles[doc], path, data[doc])`) | `{name} is a {type} variable, but this field takes {expected}.` | — |

**Placeholder ranges:**
- Find each placeholder's literal text in `parsed.text.slice(node.range[0], node.range[1])`. Search forward from the previous match.
- When the literal text is not found (escapes or folding), use the scalar's own range.
- Walk the YAML nodes, not the data, so ranges exist. Skip alias nodes and the `x-variables` subtree.

- [ ] **Step 1: Write the failing tests:**

```ts
// fit.test.ts
it.each([
  [{ type: 'port' }, { type: ['integer', 'string'] }, true], [{ type: 'boolean' }, { type: ['integer', 'string'] }, false],
  [{ type: 'string' }, { type: ['boolean', 'string'] }, false], [{ type: 'boolean' }, { type: ['boolean', 'string'] }, true],
  [{ type: 'string' }, { type: 'string' }, true], [{ type: 'port' }, { type: 'string', pattern: '^x$' }, true],
  [{ type: 'enum', enumValues: ['a'] }, { type: 'string', enum: ['a', 'b'] }, true],
  [{ type: 'enum', enumValues: ['c'] }, { type: 'string', enum: ['a', 'b'] }, false],
])('fitsField(%j, %j) is %s', (decl, schema, want) => expect(fitsField(decl, schema)).toBe(want));
it('inferVariableType', …)  // {type:['integer','string']}→'number', {type:['boolean','string']}→'boolean', {type:'string'}→'string'
// compose-variables-rules.test.ts (through validateText on composeFormat)
it('undeclared placeholder: warning with exact range and a declareVariable fix typed from the field', …)
  // ports: ["${WEB_PORT}:80"] → type 'string' fix; scale: ${N} → type 'number'
it('${X:-a} undeclared still warns; the fix carries default a', …)
it('$$ and $${X} produce nothing', …)                                   // Review Focus 1
it('CRLF text: the range covers exactly ${NAME}, plain and double-quoted', …) // Review Focus 2
it('inline default differing from declared default warns; equal does not', …)
it('malformed block entries: one variable-declaration error each, at the node; valid ones still declare', …) // Review Focus 4
it('variable-declaration is silent when variables come from the host', …)
it('variable-type: boolean variable in scale → error; number variable → none', …)
it('a placeholder inside x-variables is never reported', …)
```

- [ ] **Step 2: Run** both test files. Expected: FAIL.
- [ ] **Step 3: Implement** `fit.ts`, then `rules.ts`, then wire `composeFormat.rules`. The `reason` texts are entries such as `'variable-declaration.badType': () => 'unknown type'` in the rule's `messages`, so hosts can translate them.
- [ ] **Step 4: Run** the tests, the full suite and `check-entry`. Expected: PASS.
  - Existing tests that expect "no problems" for compose text with placeholders (for example around `test/fixtures/corpus/compose-env-placeholders.yaml`) will now see `undeclared-variable` warnings.
  - Update each such assertion to expect exactly those warnings. Never loosen it to ignore rule problems.
- [ ] **Step 5: Commit**: `feat(compose): variable rules and type fit`.

---

### Task 5: Kubernetes semantic rules

**Files:**
- Create: `packages/core/src/formats/kubernetes/rules.ts`
- Modify: `packages/core/src/formats/kubernetes/index.ts`: `rules: kubernetesRules`.
- Test: `packages/core/test/formats/kubernetes-rules.test.ts`

**Interfaces:**
- Consumes: the `Rule`/`RuleInput`/`RuleFinding` types (Task 1).
- Produces: `export const kubernetesRules: readonly Rule[]`, with ids `service-selector`, `selector-mismatch`, `missing-resources` and `target-port`.

**Where workloads keep their pod templates (D7):**

| Kind | Pod template | Selector |
| --- | --- | --- |
| Deployment, StatefulSet, DaemonSet, ReplicaSet | `spec.template` | `spec.selector.matchLabels` |
| Job | `spec.template` | none checked |
| CronJob | `spec.jobTemplate.spec.template` | none checked |
| Pod | the document itself (labels at `metadata.labels`, containers at `spec.containers`) | none checked |

The namespace is `metadata.namespace`. A missing namespace is `default`.

**Rules:**

| id | Severity | Finding | Message | Fix |
| --- | --- | --- | --- | --- |
| `service-selector` | warning | A Service's `spec.selector` (a non-empty map) matches no pod template labels among the workloads in its namespace. Only reported when that namespace has at least one workload. Reported at `['spec', 'selector']`, `at: 'key'`. | `No workload in this file has the labels {selector}.`, where `selector` is `k=v` pairs joined with `, ` | — |
| `selector-mismatch` | error | A `matchLabels` entry that is missing from, or different in, the template labels. Reported at `['spec', 'selector', 'matchLabels']`, `at: 'key'`. | `The selector does not match the pod template labels: {labels}.`, where `labels` lists the mismatched `k=v` | — |
| `missing-resources` | warning | A container with no `resources`, or with `resources` that has neither `requests` nor `limits`. Reported at the container's item path, or at its `name` value when present. | `Container "{name}" has no resource requests or limits.` | `fix.add-resources` (`Add resource requests and limits`), action `edit` with one `add` at the container: key `resources`, value `{ requests: { cpu: '100m', memory: '128Mi' }, limits: { memory: '256Mi' } }`. When an empty `resources: {}` exists, the fix does `delete` first, then `add`. |
| `target-port` | warning | A string `targetPort` in `spec.ports[i]` of a Service that matches at least one workload, when no container in any matched workload has a port with that `name`. Reported at `['spec', 'ports', i, 'targetPort']`. | `No container port is named "{port}" in the selected workloads.` | — |

- [ ] **Step 1: Write the failing tests** (multi-document fixtures inline):

```ts
it('service-selector: warns when nothing matches; silent when one of two workloads matches', …)   // Review Focus 3
it('service-selector: a workload in another namespace does not count', …)                        // Review Focus 3
it('service-selector: silent when the file has no workloads, or the Service has no selector', …)
it('selector-mismatch: error naming the mismatched pairs; silent when matchLabels ⊆ template labels', …)
it('selector-mismatch: CronJob and Job are not checked; matchExpressions alone is silent', …)
it('missing-resources: Deployment, CronJob and Pod containers; initContainers are not checked', …)
it('missing-resources fix: applying its ops yields a document where the rule is silent', …)
it('target-port: a name found in any matched workload is fine; an unknown name warns', …)          // Review Focus 3
it('target-port: numeric targetPort is never checked', …)
it('rules see merged data: labels from a merge key count', …)
// and extend test/validation/perf.test.ts: the existing 1,000-line case, with rules enabled, stays under 50 ms
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/formats/kubernetes-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `rules.ts` over `RuleInput.data`. Collect the workloads once per check. Never throw on unexpected shapes: skip anything that is not a record.
- [ ] **Step 4: Run** the test file, the full suite, and `check-entry` after building. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(kubernetes): semantic rules`.

**Midpoint checkpoint:**
- Run `pnpm build && pnpm test && pnpm typecheck && pnpm --filter @stack-weaver/core exec node scripts/check-entry.mjs && pnpm pack:check`. The headless engine is complete here.
- Note the entry-size delta in the ledger. It should be about 0, because only types and dispatch were added to the entry.

---

### Task 6: Editor variable store, host API and quick-fix application

**Files:**
- Create: `packages/core/src/editor/variables.ts`
- Modify: `packages/core/src/editor/context.ts`: the `EditorContext` additions below.
- Modify: `packages/core/src/editor/editor.ts`: the options, methods and wiring.
- Modify: `packages/core/src/editor/problems.ts`. `validateCurrent` passes `variables` for the `external` store.
- Modify: `packages/core/src/index.ts`: export `VariableStore` and `VariablesOption`.
- Test: `packages/core/test/editor/variables.test.ts`

**Interfaces:**
- Consumes: `FormatVariables` (Task 1), `checkDecl` and `NAME_PATTERN` from `src/variables/decl.ts` (Task 3), `DocumentStore.edit(op, { group })`.
- Produces:

```ts
export type VariablesOption = { readonly store: 'x-variables' } | { readonly store: 'external'; readonly value: readonly VariableDecl[] };
/** Where declarations live; the editor creates one per instance. */
export interface VariableStore {
  readonly kind: 'x-variables' | 'external';
  get(): readonly VariableDecl[];
  /** Adds or replaces (by `replaces ?? decl.name`); false when refused (read-only, invalid, name taken, edit refused). */
  set(decl: VariableDecl, replaces?: string): boolean;
  remove(name: string): boolean;
}
// ManifestEditorOptions gain:
readonly variables?: VariablesOption;                                           // default { store: 'x-variables' }; init-only
readonly onVariablesChange?: (decls: readonly VariableDecl[]) => void;          // a throw is logged
// ManifestEditor gains:
getVariables(): readonly VariableDecl[];
setVariables(decls: readonly VariableDecl[]): void;  // external only (D5); TypeError on invalid decls
applyFix(problem: Problem): boolean;                 // false: no fix, read-only, destroyed, or refused
// EditorContext gains:
variables(): VariableStore | undefined;               // undefined while the format has no `variables`
onVariables(fn: (decls: readonly VariableDecl[]) => void): () => void;
applyFix(problem: Problem): boolean;
```

**Behaviour:**
- **`x-variables` store:**
  - `get()` returns `format.variables.read(store.parsed)`, from the last good parse while the text is broken.
  - `set`/`remove` apply the ops with one `group`, `variables:<n>`, unique per call, so one call is one undo step.
  - Refused while the text does not parse.
- **`external` store:** holds an array.
- **Change tracking:**
  - After each store change and each `set`/`remove`, compare the signature (`JSON.stringify`) with the last one.
  - On a change, notify `onVariables` listeners and `onVariablesChange`, without echoing `setVariables`.
  - On an `external` change, also call `scheduler.run()` directly: the scheduler's staleness guard is text-only.
- **`applyFix`:**
  - `declareVariable` → `variables()?.set(decl)`.
  - `edit` → `store.edit` of every op under one group.
  - Returns false when any op is refused. Ops already applied stay, and stay undoable as that one step.

- [ ] **Step 1: Write the failing tests** (happy-dom, fake adapter, `await editor.ready`):

```ts
it('x-variables: getVariables reads the block; a text edit of the block fires onVariablesChange once', …)
it('x-variables: applyFix(declare) writes the block; one undo removes it and fires onVariablesChange', …) // Review Focus 5
it('external: initial value, getVariables, and invalid initial value throws TypeError', …)
it('external: applyFix(declare) leaves the text unchanged, fires onVariablesChange, and the undeclared problem disappears without typing', …) // Review Focus 5
it('external: setVariables re-validates, does not fire onVariablesChange, and throws on a duplicate name', …)
it('x-variables: setVariables warns and changes nothing', …)
it('kubernetes: variables() is undefined and getVariables returns the external value or []', …)
it('applyFix(edit) applies missing-resources as one undo step; read-only returns false', …)
it('no variable callback after destroy', …)
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/editor/variables.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `editor/variables.ts`. Then add the context, editor and scheduler wiring. Update the `ManifestEditorOptions` TSDoc, including the init-only list.
- [ ] **Step 4: Run** the test, then the full suite. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(editor): variable stores, onVariablesChange and applyFix`.

---

### Task 7: Quick fixes in the problems panel, the rows and the code pane

**Files:**
- Modify: `packages/core/src/editors/adapter.ts`. Add `CodeDiagnostic.actions?: readonly { readonly label: string; apply(): void }[]` (additive; Plan 4 owns the adapter reshape).
- Modify: `packages/core/src/editors/codemirror/index.ts`. Map `actions` to `@codemirror/lint` `Diagnostic.actions` (`{ name: label, apply: () => a.apply() }`).
- Modify: `packages/core/src/editor/code-pane.ts`. In `setProblems`, a problem with `fix` gets one action, which calls `ctx.applyFix`.
- Modify: `packages/core/src/editor/problems-panel.ts`. Each item with a `fix` gets a sibling `button.sw-problem-fix`, whose text is `fix.label`.
- Modify: `packages/core/src/visual/widgets/field-row.ts`. Each row problem with a `fix` gets a `button.sw-row-fix`.
- Modify: `packages/core/src/styles/stack-weaver.css`. Add `.sw-problem-fix` and `.sw-row-fix`, using control-border tokens and a visible focus.
- Modify: `packages/core/test/editors/adapter-contract.ts` and the fake adapter. The contract covers actions.
- Test: `packages/core/test/editor/quick-fix.test.ts`

**Interfaces:**
- Consumes: `ctx.applyFix` (Task 6); `Problem.fix` (Task 1).
- Produces: the classes `sw-problem-fix` and `sw-row-fix` (public CSS API).

**Layout and focus:**
- The panel item becomes `li > [button.sw-problem, button.sw-problem-fix]`. Don't nest a button in a button.
- The fix button's accessible name is `fix.label`, plus the problem message through `aria-describedby`.
- After a fix is applied, focus moves to the problems toggle (the item it was in is gone).

- [ ] **Step 1: Write the failing tests:**

```ts
it('panel: a fixable problem has a Fix button named by fix.label; clicking applies it', …)
it('panel: focus lands on the problems toggle after the fix removes the item', …)
it('row: the visual row of an undeclared placeholder shows the fix and applying it declares the variable', …)
it('code pane: the fake adapter receives a diagnostic with one action labelled fix.label; apply() applies the fix', …)
it('contract: a real CodeMirror diagnostic carries the action (codemirror.test.ts)', …)
it('read-only: fix buttons are disabled', …)
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/editor/quick-fix.test.ts test/editors`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite, including `test/styles/css.test.ts` and `test/editor/a11y.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(editor): quick fixes in panel, rows and code pane`.

---

### Task 8: The Variables section

**Files:**
- Create: `packages/core/src/visual/variables-section.ts`
- Modify: `packages/core/src/visual/outline-model.ts`.
  - `OutlineNode.type` gains `'variables'`.
  - `buildOutline` gains a `hiddenRootKey?: string` parameter. For `mapping` formats, it skips that root key.
- Modify: `packages/core/src/visual/visual-pane.ts`.
  - When `ctx.variables()` exists, prepend the node `{ id: 'variables', ref: { doc: 0, path: [] }, label: ui.variables, type: 'variables', children: [] }`.
  - Pass `hiddenRootKey` (the format's `variables.key`) only for the `x-variables` store.
  - `renderSelection` mounts `mountVariablesSection` for that node. The remove-section control has no target there.
  - The section re-renders on `ctx.onVariables`.
- Modify: `packages/core/src/visual/outline.ts`, only if it needs the new type for its icon or label.
- Modify: `packages/core/src/editor/messages.ts`. Add the keys listed below.
- Modify: `packages/core/src/styles/stack-weaver.css`. Add `.sw-variables`, `.sw-variable` and `.sw-variable-*`.
- Test: `packages/core/test/visual/variables-section.test.ts`

**Interfaces:**
- Consumes: `ctx.variables()`, `ctx.onVariables` (Task 6).
- Produces:
  - `mountVariablesSection(ctx: EditorContext, doc: Document): { el: HTMLElement; update(): void; focusFirst(): void; destroy(): void }`;
  - the outline node type `'variables'`;
  - these UiMessages keys, with English defaults:

| Key | Default |
| --- | --- |
| `variables` | `Variables` |
| `addVariable` | `Add variable` |
| `variableName` | `Name` |
| `variableType` | `Type` |
| `variableDefault` | `Default` |
| `variableEnumValues` | `Allowed values (comma-separated)` |
| `variableDescription` | `Description` |
| `removeVariable` | `Remove variable {name}` |
| `variableNameInvalid` | `Use letters, digits and _, starting with a letter or _.` |
| `variableNameTaken` | `A variable named {name} already exists.` |
| `variablesEmpty` | `No variables yet. Variables keep values like ports and tags in one place; fields refer to them as ${NAME}.` |
| `variableTypeString` | `Text` |
| `variableTypeNumber` | `Number` |
| `variableTypeBoolean` | `Yes/No` |
| `variableTypePort` | `Port` |
| `variableTypeEnum` | `One of a list` |

**Behaviour:**
- **Layout:** one `fieldset.sw-variable` per declaration, with `legend` = name. It holds these controls:
  - **name** (`input`): commits on `change`. On an invalid or taken name it shows the message, sets `aria-invalid`, and commits nothing.
  - **type** (`select`): on a change, a default that no longer fits the new type is dropped.
  - **default:** text for string, number and port; a `select` (empty/true/false) for boolean; a `select` of the values for enum. Number and port must parse as numbers before committing; port must also be from 1 to 65535.
  - **allowed values:** only for enum.
  - **description**;
  - **remove** button.
- **Commits:** every commit is one `ctx.variables().set(...)` (one undo step).
- **"Add variable":** adds `{ name: 'VAR_<n>', type: 'string' }`, with the lowest unused `n` starting at 1, then focuses its name input.
- **Read-only:** controls are disabled when `ctx.readOnly()` or the text is broken.
- **Focus:** focus stays in the edited control across re-renders, because cards are keyed by name and patched in place.

- [ ] **Step 1: Write the failing tests:**

```ts
it('compose: the outline starts with Variables; the x-variables key is hidden under the x-variables store', …)
it('compose + external store: Variables is shown and an x-variables key in the text stays a normal node', …)
it('kubernetes: no Variables node', …)
it('lists declarations; editing default writes a typed default to the block (one undo step)', …)
it('renaming commits on change; an invalid or taken name shows the message and changes nothing', …)
it('changing type to enum shows allowed values; an incompatible default is dropped', …)
it('Add variable adds VAR_1, then VAR_2, and focuses the name input', …)
it('remove deletes the declaration; with the last one the block goes', …)
it('external store: edits fire onVariablesChange and never touch the text', …)
it('every control has an accessible name; read-only disables them', …)
```

- [ ] **Step 2: Run** `pnpm --filter @stack-weaver/core exec vitest run test/visual/variables-section.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite, including the outline, a11y and css tests. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(visual): Variables section`.

---

### Task 9: "Use variable" in field rows, union widgets, and `${` completion

**Files:**
- Create: `packages/core/src/visual/widgets/variable-binding.ts`
- Modify: `packages/core/src/visual/widgets/field-row.ts`.
  - Scalar widget rows of a format with `variables` get a toggle button in the row head.
  - In variable mode, the body is the binding select.
  - A typed widget never shows a non-placeholder string (D9): `mode = 'text'`.
- Modify: `packages/core/src/visual/widgets/registry.ts`. `baseType` treats `[T, 'string']` (T one of `boolean`, `integer`, `number`, ignoring `null`) as T. Update the `pickWidget` TSDoc.
- Modify: `packages/core/src/editor/code-pane.ts`. Variable-name completion inside `${`.
- Modify: `packages/core/src/editor/messages.ts`. Add these keys:

| Key | Default |
| --- | --- |
| `useVariable` | `Use variable` |
| `variableSelect` | `Variable for {label}` |
| `variableNone` | `No variables of this type yet. Add one under Variables.` |
| `variableUndeclared` | `{name} (not declared)` |
| `variableCompletion` | `Variables` |

- Modify: `packages/core/src/styles/stack-weaver.css`
- Test: `packages/core/test/visual/variable-binding.test.ts`. Also extend `packages/core/test/visual/widgets.test.ts` (union types) and `packages/core/test/editor/sync.test.ts` or a new `test/editor/variable-completion.test.ts`.

**Interfaces:**
- Consumes: `fitsField` (Task 4), `FormatVariables.referenceOf`/`.reference` (Task 1/3), `ctx.variables()`/`onVariables` (Task 6).
- Produces: `mountVariableBinding(ctx: EditorContext, o: { id: string; label: string; ref: NodeRef; schema: JsonSchema; value: YamlValue; readOnly: boolean }): WidgetInstance`, plus the classes `sw-row-variable-toggle` and `sw-variable-binding`.

**Behaviour:**
- **The toggle** is a `button` with `aria-pressed`, and `aria-label` = `useVariable`.
- **Pressed state:** it is pressed when `referenceOf(String(value))` names a variable.
- **Pressing it:** shows the select (fitting variables only, sorted by name). Nothing is committed until a variable is chosen, and choosing commits the bare `reference(name)`, which is a string.
- **No fitting variable:** the select is replaced by the `variableNone` text.
- **Undeclared or misfit references:** a current reference that is undeclared or doesn't fit stays listed, as `variableUndeclared`, with that name selected.
- **Unpressing it:** commits the variable's declared default (typed) when there is one. Otherwise it commits nothing and shows the type widget.
- **Code completion:**
  - With `format.variables` present, when the text before the caret on the line matches `/\$\{([A-Za-z_][A-Za-z0-9_]*)?$/` and the caret is in a value, complete from the variable names.
  - Each completion has `label` = name, `apply` = `name}` (unless the next character is `}`, then just the name), `detail` = the type, and `section` = `{ name: ui.variableCompletion, rank: 0 }`.
  - `from` = the caret minus the typed part.

- [ ] **Step 1: Write the failing tests:**

```ts
it('pickWidget: {type:["boolean","string"]} → boolean; ["integer","string"] → integer; ["number","string","null"] → number', …)
it('kubernetes rows have no toggle; compose scalar rows do', …)
it('a ${WEB_PORT} value opens in variable mode with WEB_PORT selected', …)
it('the select lists only fitting variables: scale lists number/port, not string or boolean', …)
it('choosing commits bare ${NAME} as one undo step; toggling off commits the typed default', …)
it('an undeclared reference shows "(not declared)" and stays selected', …)
it('a boolean field holding the string "yes" shows read-only text, not the boolean widget', …)
it('code: typing "${W" in a compose value offers WEB_PORT; kubernetes offers nothing', …)
```

- [ ] **Step 2: Run** the new and extended tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite and `check-entry`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(visual): use-variable toggle, union widgets and variable completion`.

---

### Task 10: Playground, docs, release prep and browser verification

**Files:**
- Modify: `packages/core/examples/playground.ts` and `playground.html`.
  - Add a "Variables store" select (`x-variables` | `external`). It recreates the editor.
  - Add a compose sample that uses `${WEB_PORT}` and `${TAG}`, with an `x-variables` block.
  - Show an `onVariablesChange` log.
- Modify: `README.md` (core). Add a "Compose variables" section (both stores, the D2 YAML shape, `getVariables`/`setVariables`, `applyFix`) and a "Semantic rules" section (the rule list and codes, `FormatDefinition.rules`, message overrides).
- Modify: `docs/superpowers/specs/2026-10-30-stack-weaver-design.md`.
  - Host API: drop the "Plan 3" markers.
  - Add `getVariables`, `setVariables` and `applyFix`.
  - Record D1, D2, D5 and D9 under "Decisions from the builder check".
- Modify: `docs/superpowers/notes/2026-10-30-plan-1-followups.md`. Add a "Plan 3" section with deferred minors (the executor appends them). Add `CodeDiagnostic.actions` and `Problem.fix` to the Plan 4 adapter and `Problem` hardening items.
- Create: `.changeset/variables-rules.md` (`@stack-weaver/core` minor): variables, rules and quick fixes. List the additive public API.

**Steps:**
- [ ] **Step 1: Release chain.** Run `pnpm build && pnpm test && pnpm typecheck && (cd packages/core && node scripts/check-entry.mjs) && pnpm pack:check`. Expected: all exit 0. Record the entry file count and gzip size in the ledger.
- [ ] **Step 2: Browser verification** with chrome-devtools MCP against `pnpm --filter @stack-weaver/core dev`:
  1. In the compose sample, set the type of `WEB_PORT` to boolean in the Variables section. The `variable-type` error appears in the panel and inline.
  2. In Code mode, type `${NEW}`. The warning and its Fix button appear. Fix → the block gains `NEW`, and one Mod-z removes it.
  3. Do the same with the `external` store. The text is unchanged, the log shows the new list, and the warning clears.
  4. In the Kubernetes "Web app" recipe, delete `resources` (if present) or change a Service selector label. Each warning appears, and the resources Fix clears its warning.
  5. Run Lighthouse accessibility in the light and dark themes. Both score 100.
- [ ] **Step 3: Fix** anything Step 2 finds, with a test for each fix. Re-run Step 1.
- [ ] **Step 4: Commit**: `docs: variables and rules (README, spec, playground, changeset)`.

---

## Spec coverage in this plan

| Spec item | Task |
| --- | --- |
| `rules?` on the format registry; semantic rules as format plugins | 1, 4, 5 |
| About 5 v1 rules: Service selector, Deployment selector vs template, missing `resources`, `targetPort` name, undeclared `${VAR}` | 5 (four), 4 |
| Problem: "optional quick fix"; shown in both panes, the panel, and linked | 1, 7 |
| `VariableDecl` types | 1, 3 |
| "Use variable" toggle lists only fitting variables | 4 (fit), 9 |
| Bare `${VAR}` written; inline defaults kept | 9, 2 |
| Substitution before schema checks; no-default checked by type only | 2, 3, 4 (D1) |
| Inline default ≠ declared default → warning | 4 |
| Undeclared → warning + "Declare variable" | 4, 6, 7 |
| `VariableStore`, `x-variables` and `external`, `onVariablesChange` | 3, 6 |
| Compose root sections include **Variables** | 8 |
| Verification: "Variables: substitution and validation, both stores, quick fixes" | 2–9, 10 |

**Deferred:**
- reference rewriting on rename (D6);
- `matchExpressions` (D7);
- hover for `${VAR}` in code mode;
- recipes that declare variables;
- Plan 4 hardening.
