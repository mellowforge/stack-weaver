# grid-master survey (facts only). Repo: ~/Developer/grid-master, npm scope @dash-builder, GitHub Constantine-24/dash-builder

## 1. Root
Files: package.json, pnpm-workspace.yaml, tsconfig.base.json, .nvmrc (`22`), .gitignore, LICENSE, README.md, CONTRIBUTING.md,
.changeset/{config.json,README.md}, .github/{workflows/{ci,pages,release}.yml, dependabot.yml, ISSUE_TEMPLATE/*, PULL_REQUEST_TEMPLATE.md},
scripts/pack-check.mjs, docs/images/demo.png, docs/superpowers/{plans,specs}/.

### package.json (root, private "dash-builder-monorepo")
"packageManager": "pnpm@12.11.2"; "engines": {"node": ">=22"}
scripts:
  "test": "pnpm -r test"
  "test:smoke": "pnpm -r test:smoke"
  "build": "pnpm -r build"
  "typecheck": "pnpm -r typecheck"
  "build:site": "pnpm -r build && pnpm --filter @dash-builder/site build:site && pnpm --filter @dash-builder/site check"
  "changeset": "changeset"
  "version-packages": "changeset version && pnpm install --lockfile-only"
  "release": "pnpm build && pnpm test && pnpm pack:check && changeset publish"
  "pack:check": "node scripts/pack-check.mjs"
devDeps: "@arethetypeswrong/cli": "^0.18.5", "@changesets/cli": "^2.31.1"
(pnpm -r runs in topological order, so core builds before wrappers; tests import built dist.)

### pnpm-workspace.yaml (verbatim)
packages:
  - "packages/*"
  # The Angular library's own manifest, so Changesets versions it and pnpm publishes it
  # from its ng-packagr output (publishConfig.directory)
  - "packages/angular/projects/grid-angular"
  - "site"
allowBuilds:
  "@parcel/watcher": true
  esbuild: true
  lmdb: true
  msgpackr-extract: true
NOTE: packages/* matches packages/angular (outer Angular CLI workspace, name @dash-builder/angular-workspace, private) AND packages/demo-kit, core, react.
The inner packages/angular/projects/grid-angular is a SEPARATE workspace member (name @dash-builder/angular).

### tsconfig.base.json
{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","lib":["ES2022","DOM"],"strict":true,"skipLibCheck":true,"isolatedModules":true,"declaration":true,"esModuleInterop":true}}
(core/react/demo-kit extend it; Angular workspace has its own standalone tsconfig; site overrides module ESNext/Bundler.)

### .changeset/config.json
$schema https://unpkg.com/@changesets/config@3.1.4/schema.json; "changelog":"@changesets/cli/changelog"; "commit":false;
"fixed":[["@dash-builder/core","@dash-builder/angular","@dash-builder/react"]]; "linked":[]; "access":"public"; "baseBranch":"main";
"updateInternalDependencies":"patch"; "ignore":[]; "privatePackages":{"version":false,"tag":false};
"___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH":{"onlyUpdatePeerDependentsWhenOutOfRange":true}
Private packages (site, demo-kit, angular-workspace) are not versioned/tagged. Only .changeset/{README.md,config.json} present (the 0.1.0 changeset consumed).

### scripts/pack-check.mjs
Run after `pnpm build`. PACKAGES array (dir, attw args, required files):
  packages/core   attw ['--profile','esm-only','--exclude-entrypoints','grid.css']  required dist/index.js, dist/index.d.ts, dist/grid.css
  packages/react  attw ['--profile','esm-only']  required dist/index.js, dist/index.d.ts
  packages/angular/projects/grid-angular  attw ['--profile','esm-only']  required fesm2022/dash-builder-angular.mjs, types/dash-builder-angular.d.ts
ALWAYS = ['package.json','README.md','LICENSE'].
FORBIDDEN regexes: /^src\//, /^test\//, /^scripts\//, /^demo\//, /^examples\//, /\.spec\./, /\.test\./, /^tsconfig/
Per package: `pnpm pack --json --pack-destination <tmp>` with cwd=pkg.dir (pnpm honours publishConfig.directory so Angular packs ../../dist/grid-angular).
Checks: required files present; no forbidden paths; extracts package/package.json via `tar -xOf` and fails if any *dependencies* field (peer/dev/etc, case-insens. contains "dependencies") has a `workspace:` range left;
runs `pnpm exec attw <tarball> --format ascii <attw args>`; prints ✓/✗ + file list; exit 1 on any problem.
Comment: "All three packages are ESM-only (no `require` condition), so attw checks the ESM profile."
Package list is hard-coded (not discovered). Angular dir is the inner project (found by explicit path).

### .github/workflows
ci.yml ("CI"): on pull_request + push main; concurrency group ci-${{ github.ref }} cancel-in-progress; permissions contents: read; one job `verify` (ubuntu-latest, 20 min):
  actions/checkout@v7 (persist-credentials:false); pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0 (version from packageManager);
  actions/setup-node@v7 (node-version-file: .nvmrc, cache: pnpm); `pnpm install --frozen-lockfile`;
  steps: Build packages (`pnpm build`) -> Type-check (`pnpm typecheck`) -> Unit tests (`pnpm test`) -> Smoke (`pnpm test:smoke`) ->
  LICENSE parity (loop `cmp LICENSE "$copy"` for packages/core/LICENSE packages/react/LICENSE packages/angular/projects/grid-angular/LICENSE, ::error annotation) ->
  `pnpm pack:check` -> Build the demo site (`pnpm --filter @dash-builder/site build:site` then `... check`).
pages.yml ("Deploy demo site"): on push main + workflow_dispatch; permissions contents: read; concurrency group pages (no cancel);
  job build: checkout, pnpm setup, node, install, `pnpm -r build`, `pnpm -r test`, `pnpm --filter @dash-builder/site build:site` with env SHOW_NPM: '1',
  `pnpm --filter @dash-builder/site check`, actions/upload-pages-artifact@v5 path site/dist.
  job deploy (needs build; permissions pages: write, id-token: write; environment github-pages with url output): actions/deploy-pages@v5.
  Comment: GITHUB_REPOSITORY set by Actions -> site gets /<repo>/ base. Repo Settings->Pages->Source: GitHub Actions (manual, once).
release.yml ("Release"): on push main; concurrency `release-${{ github.ref }}`; permissions contents: write, pull-requests: write, id-token: write;
  job release (30 min): checkout@v7 (no persist-credentials:false here), pnpm setup, setup-node@v7 with node-version-file + `package-manager-cache: false`, install --frozen-lockfile,
  changesets/action@a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d # v1.9.0 with version: pnpm version-packages, publish: pnpm release,
  commit/title: 'chore(release): version packages'; env GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}, NPM_CONFIG_PROVENANCE: 'true'.
  No NPM_TOKEN anywhere (OIDC trusted publishing; changesets/action skips .npmrc when OIDC available; pnpm does OIDC exchange).
dependabot.yml: npm weekly with groups angular (@angular/*, @angular-devkit/*, ng-packagr, zone.js), react (react, react-dom, @types/react*, @vitejs/plugin-react, @testing-library/*), dev-tooling (dev deps minor/patch, excluding those);
  ignores semver-major for @angular/*, react, react-dom, typescript (Angular pinned to TS ~6.0), @changesets/cli; github-actions monthly, ignore changesets/action major.

### Root README.md headings
# dash-builder (badges/screenshot) / Why dash-builder? / Packages / Installation / Quick start (### React, ### Angular, ### Vanilla JS / TS) / The layout / Drop modes / How it works / Documentation / Compatibility (table) / Limitations / Contributing / License.
Compatibility rows: core "Any evergreen browser (ES2022, CSS grid)"; react "React 19. Safe under <StrictMode> and server rendering."; angular "Angular 22, standalone. Works with zone.js and zoneless."
CONTRIBUTING.md sections: Getting started, Project layout (table), Development loop, Demo site, Pull requests, Releases (+ ### First publish, ### GitHub Pages).
PR rule: "A change to one wrapper comes with the same change in the other." Conventional Commits (`feat(react): …`).

### .gitignore (verbatim lines)
node_modules / dist / .superpowers/ / .claude/ / packages/angular/.angular/ / packages/react/dist-demo
(site/dist covered by `dist`; Angular out dirs `packages/angular/dist` covered by `dist`.)

## 2. packages/react (@dash-builder/react 0.1.0)
package.json: "type":"module"; "types":"./dist/index.d.ts"; "exports":{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"}}; "sideEffects": false;
"files":["dist","README.md","LICENSE","CHANGELOG.md"]; publishConfig {access: public}; metadata: license MIT, author, homepage (pages URL), repository {type git,url git+https://github.com/Constantine-24/dash-builder.git,directory packages/react}, bugs, keywords [... "react"].
scripts: build "tsc -p tsconfig.build.json"; test "vitest run"; typecheck "tsc --noEmit -p tsconfig.json"; demo "vite"; build:demo "vite build"; test:smoke "pnpm build && node scripts/smoke.mjs"
peerDependencies: "@dash-builder/core": "workspace:0.x", "react": "^19.0.0", "react-dom": "^19.0.0"
devDependencies: "@dash-builder/core":"workspace:*", "@testing-library/dom":"^10.4.2", "@testing-library/react":"^16.3.3", "@types/react":"^19.3.0", "@types/react-dom":"^19.3.0", "@vitejs/plugin-react":"^6.1.2", "happy-dom":"^21.0.4", "react":"^19.3.1", "react-dom":"^19.3.1", "typescript":"^7.0.2", "vite":"^8.3.5", "vitest":"^5.0.5"
No runtime dependencies. Plain tsc (no bundler) emits dist/*.js + .d.ts; relative imports use `.js` suffix.
tsconfig.json: extends ../../tsconfig.base.json; {rootDir ".", outDir "dist", noEmit true, jsx "react-jsx"}; include [src,test,demo,vitest.config.ts,vite.config.ts]
tsconfig.build.json: rootDir src, outDir dist, noEmit false, declaration true, jsx react-jsx; include [src].
vite.config.ts: {root:'demo', plugins:[react()], build:{outDir:'../dist-demo', emptyOutDir:true}}   (dev demo only; dist-demo gitignored)
vitest.config.ts: {test:{environment:'happy-dom', include:['test/**/*.test.tsx']}}   (no setup file, no globals)
scripts/smoke.mjs: asserts dist/index.js exists; imports '@dash-builder/react' (self-reference via exports): Grid & Widget & WidgetHandle are functions, Widget.Handle===WidgetHandle;
  asserts pkg.name, peerDependencies deepEqual {'@dash-builder/core':'workspace:0.x', react:'^19.0.0','react-dom':'^19.0.0'}, no `dependencies`, LICENSE exists.
Files: LICENSE (byte copy of root), CHANGELOG.md, README.md.
src/:
  index.ts   exports Grid, GridProps, GridHandle, Widget, WidgetHandle, WidgetProps, and re-exports types LayoutItem, DropMode, RejectReason, DropResult from core
  grid.tsx   Grid component (207 lines)
  widget.tsx Widget + WidgetHandle (38)
  context.ts GridContext {requestRefresh()} default no-op
Public API:
  GridProps extends Omit<ComponentPropsWithoutRef<'div'>,'children'>: columns:number; layout:LayoutItem[]; onLayoutChange?; dropMode?; maxRows?; rowHeight? (80); gap? (8); breakpoint? (640); ghost?: GridOptions['ghost']; onReject?; children?; ref?: Ref<GridHandle> (React 19 ref-as-prop, no forwardRef)
  GridHandle { addItem(item, index?): DropResult; removeItem(id): void }
  WidgetProps = { id: string } & Omit<ComponentPropsWithRef<'div'>,'id'> ; id -> data-grid-id (not DOM id); className prefixed with `dash-item`
  WidgetHandle (span with data-grid-handle=""); `Widget.Handle = WidgetHandle`
Mechanics (grid.tsx):
  - Controlled only: `layout` prop, no defaultValue/uncontrolled mode. Parent must set state from onLayoutChange.
  - Callback freshness: a `latest` ref {opts, layout, onLayoutChange, onReject} updated in the FIRST useLayoutEffect (no deps, "declared first"); the controller is created once in a [] useLayoutEffect with trampolines `onLayoutChange: (next)=>{ if(!superseded.current) latest.current.onLayoutChange?.(next) }`, `onReject: r => latest.current.onReject?.(r)`.
  - Sync effect (useLayoutEffect, no deps) after every commit: if layout !== applied.current -> applied=layout; superseded=true; try setOptions(opts) finally superseded=false; then g.setLayout(layout) ("no-op on our own echo": core skips equal layouts); else g.setOptions(opts) (columns change may normalize+emit). Then g.refresh() if `dirty` ref (a widget committed) or className/style changed (shallowEqual on style).
  - Echo filtering: (a) core's setLayout ignores layouts equal to current (layoutsEqual); (b) `superseded` flag suppresses the emission from setOptions when a new layout is about to replace it.
  - Widget -> Grid: GridContext.requestRefresh sets dirty and coalesces via queueMicrotask; every Widget calls it in a no-deps useLayoutEffect and in its cleanup (returns requestRefresh).
  - Cleanup: controller.destroy() + controller.current=undefined; queued refresh finds no controller.
  - StrictMode: effect creates/destroys/creates controller; test asserts exactly one `.dash-marker`. createGrid mutates container (adds `dash-grid` class, display:grid, appends marker) — React renders `dash-grid` class + `display:grid` itself so rewriting className/style doesn't strip them.
  - GridHandle via useImperativeHandle(ref, ..., []) uses core pure planners `addItem as planAdd`, `removeItem as planRemove`, `normalizeLayout` from core and advances latest.current.layout so chained calls compose; emits via latest onLayoutChange / onReject.
  - SSR safe: no DOM at render (renderToString test).
tests (vitest + happy-dom + @testing-library/react; each test file's afterEach does `cleanup()` and `expect(errors).not.toHaveBeenCalled()` on a console.error spy):
  test/grid.test.tsx (614 lines): describe 'Grid': positions widgets; new layout re-renders w/o emitting; addItem via ref + onReject; chained add/remove compose; removeItem; columns change emits normalized once; columns+layout same render; drag e2e (stubbed rects, PointerEvent) incl. after React reorders DOM; parent re-render mid-drag; 'StrictMode: one controller'; 'inline callbacks: no re-create, newest callback wins'; unmount mid-drag no ghost; className/style change keeps core classes & vars; widget id change rebinds; wrapper component direct child. describe 'Widget inside Grid': className change, text child keeps resize handle, wrapper w/ own state, id change, Suspense + `use`, text change mid-drag, 'SSR: renders to a string'.
  test/refresh.test.tsx: vi.mock('@dash-builder/core') wraps createGrid to record refresh/destroy; tests no extra refresh on mount, coalescing, no refresh-after-destroy.
  test/widget.test.tsx: renders div w/ data-grid-id no DOM id + handle span; grid attrs win over consumer props; ref forwarding.
  The "no act" rendering concern: tests use `act` only for pointerup (`up = act(...)`); console.error spy asserts no act()/key warnings. Drag helpers dispatch events directly on document.
demo/ (dev-only Vite app, not published, not in `files`): index.html, main.tsx (StrictMode + `import '@dash-builder/core/grid.css'`), app.tsx (178 lines; add/remove via ref, mode switch, maxRows, narrow toggle, selected className toggle, status line), blocks.ts, styles.css, env.d.ts. Imports `../src/index.js` (source, not dist).
README sections: # @dash-builder/react / Install / Styles / Usage / ### Rules / API (### `<Grid>` props table; ### `<Widget>` and `Widget.Handle`; ### Adding widgets: use the ref) / Narrow view / Drop modes / Demo / License.

## 3. packages/angular (outer = Angular CLI workspace "@dash-builder/angular-workspace", private; inner = published lib)
Layout: packages/angular/{angular.json, package.json, tsconfig.json, scripts/smoke.mjs, projects/{grid-angular, demo, site-demo}}. `.angular/` and `dist/` gitignored. No `files`/`type` in inner package.json (ng-packagr generates the dist manifest).
Outer package.json: name "@dash-builder/angular-workspace", version 0.0.0, private, packageManager pnpm@12.11.2.
 scripts: "ng":"ng", "build":"ng build grid-angular && ng build demo", "start":"ng build grid-angular && ng serve demo", "test":"ng test grid-angular --watch=false", "typecheck":"tsc --noEmit -p projects/grid-angular/tsconfig.lib.json", "test:smoke":"pnpm build && node scripts/smoke.mjs"
 dependencies: @angular/{common,compiler,core,platform-browser} "^22.2.0", "rxjs":"~7.8.0", "tslib":"^2.3.0"
 devDependencies: "@angular/build":"22.2.4", "@angular/cli":"22.2.4" (exact pins), "@angular/compiler-cli":"^22.2.0", "@dash-builder/core":"workspace:*", "@dash-builder/demo-kit":"workspace:*", "happy-dom":"^21.0.4", "ng-packagr":"^22.2.0", "typescript":"~6.0.2", "vitest":"^5.0.5", "zone.js":"~0.16.3"
 NOTE TS: Angular workspace uses TS ~6.0.2 while core/react/demo-kit/site use ^7.0.2. No @angular/platform-browser-dynamic, no @analogjs.
Inner projects/grid-angular/package.json (verbatim essentials): "name":"@dash-builder/angular","version":"0.1.0", license/author/homepage/repository{directory:"packages/angular/projects/grid-angular"}/bugs/keywords;
  "peerDependencies":{"@angular/common":"^22.0.0","@angular/core":"^22.0.0","@dash-builder/core":"workspace:0.x"}; "sideEffects": false;
  "publishConfig":{"access":"public","directory":"../../dist/grid-angular","linkDirectory":false}
  (publishConfig.directory => pnpm publishes/packs from packages/angular/dist/grid-angular; dist's package.json is ng-packagr-generated from this; pnpm rewrites workspace:0.x -> 0.x at pack time.)
ng-package.json: {"$schema":"../../node_modules/ng-packagr/ng-package.schema.json","dest":"../../dist/grid-angular","assets":["LICENSE","CHANGELOG.md"],"lib":{"entryFile":"src/public-api.ts"}}
  (README.md auto-copied by ng-packagr; LICENSE + CHANGELOG listed as assets.) Dist output: packages/angular/dist/grid-angular/{CHANGELOG.md,LICENSE,README.md,package.json,fesm2022/dash-builder-angular.mjs,types/dash-builder-angular.d.ts}
angular.json: version 1; cli.packageManager pnpm; newProjectRoot projects; projects:
  grid-angular: library, prefix "dash", build builder "@angular/build:ng-packagr" with configurations production {tsConfig projects/grid-angular/tsconfig.lib.prod.json} / development {tsconfig.lib.json}, defaultConfiguration production;
    test builder "@angular/build:unit-test" options {tsConfig "projects/grid-angular/tsconfig.spec.json", providersFile "projects/grid-angular/test-providers.ts"}   <- runner = Angular's built-in Vitest (vitest ^5.0.5 devDep, happy-dom); no karma/jest/analog.
  demo: application, prefix app, builder @angular/build:application (browser projects/demo/src/main.ts, styles projects/demo/src/styles.css, assets public/), budgets initial 500kB warn/1MB error, anyComponentStyle 4kB/8kB; serve via @angular/build:dev-server; schematics skipTests true for class/component/directive/guard/interceptor/pipe/resolver/service. Dev-only (own styles, imports @dash-builder/core/grid.css; src/app/blocks.ts).
  site-demo: application, same shape; the mini app embedded in site's Angular tab.
tsconfig.json (workspace root): compilerOptions noImplicitOverride, paths {"@dash-builder/angular": ["./dist/grid-angular"]} (so demos import built lib), noPropertyAccessFromIndexSignature, noImplicitReturns, noFallthroughCasesInSwitch, skipLibCheck, isolatedModules, experimentalDecorators, importHelpers, target ES2022, module preserve; angularCompilerOptions {enableI18nLegacyMessageIdFormat:false, strictInjectionParameters:true, strictInputAccessModifiers:true}; "files": [] + references to lib, spec, demo, site-demo tsconfigs. (Does NOT extend repo tsconfig.base.json.)
  tsconfig.lib.json extends ../../tsconfig.json: outDir ../../out-tsc/lib, declaration, declarationMap, types [], include src/**/*.ts, exclude **/*.spec.ts.
  tsconfig.lib.prod.json extends lib: declarationMap false; angularCompilerOptions.compilationMode "partial".
  tsconfig.spec.json: outDir ../../out-tsc/spec, types ["vitest/globals"], include src/**/*.d.ts, src/**/*.spec.ts, test-providers.ts.
  tsconfig.app.json (demos): extends ../../tsconfig.json, types [], include src/**/*.ts, exclude spec.
test-providers.ts (verbatim logic): `export default [provideZonelessChangeDetection()];` Comment: zone.js is a devDependency (for the zone spec) so the unit-test builder loads it and adds provideZoneChangeDetection() for every spec; suite kept zoneless by default; the zone spec opts back in via provideZoneChangeDetection() in its own configureTestingModule.
scripts/smoke.mjs: `import '@angular/compiler'` (partial-compiled output needs JIT linker in Node); imports dist/grid-angular/fesm2022/dash-builder-angular.mjs; asserts exports DashWidget, DashHandle, DashGrid; LICENSE exists in dist; dist package.json name '@dash-builder/angular'; peerDependencies equal {'@angular/common':'^22.0.0','@angular/core':'^22.0.0','@dash-builder/core':'workspace:0.x'} (source range; pnpm rewrites at publish; pack:check verifies tarball); `dependencies` may only contain tslib.
src/public-api.ts: exports DashWidget (./lib/widget.directive), DashHandle (./lib/handle.directive), DashGrid (./lib/grid.component); `export type { LayoutItem, DropMode, RejectReason, DropResult } from '@dash-builder/core'`. (No .js suffix in imports; module preserve.)
lib files: grid.component.ts (140), widget.directive.ts, handle.directive.ts, grid.component.spec.ts (340), directives.spec.ts (31).
Component API (DashGrid, selector `dash-grid`, template `<ng-content />`, OnPush, standalone-by-default (no standalone flag)):
  layout = model.required<LayoutItem[]>()  ([(layout)]);  columns = input.required<number, unknown>({transform: numberAttribute});
  dropMode = input<DropMode>('insert'); maxRows = input<number|undefined, unknown>(undefined,{transform: optionalNumber});
  rowHeight 80 / gap 8 / breakpoint 640 = input<number, unknown>(default,{transform: numberAttribute}); ghost = input<GridOptions['ghost']>();
  reject = output<RejectReason>(); methods addItem(item, index?): DropResult, removeItem(id): void (public methods, used via viewChild).
  DashWidget: selector `[dashWidget]`, `dashWidget = input.required<string>()`, host `{'[attr.data-grid-id]': 'dashWidget()'}`. DashHandle: selector `[dashHandle]`, host `{'data-grid-handle': ''}`.
  Mechanics: controller created in afterNextRender (SSR-safe), `zone.runOutsideAngular(() => createGrid(...))`; core callbacks re-enter via `zone.run(() => this.layout.set(l))` / `zone.run(() => this.reject.emit(r))`; `untracked` for initial reads; destroy in DestroyRef.onDestroy.
  One `effect()` over computed `options` + `layout()` runs `outside(g => ...)` (runOutsideAngular): same applied/superseded logic as React (layout===applied -> setOptions only; else applied=layout, superseded flag around setOptions, then setLayout).
  `afterRenderEffect(() => { widgets().forEach(w => w.dashWidget()); outside(g => g.refresh()); })` with `contentChildren(DashWidget)` = widget refresh after DOM update (the ExpressionChanged-avoidance: no signal writes in render hooks; layout.set only from core callback/zone.run or user call).
  Echo: core ignores equal layout; `superseded` flag; model.set(l) of the same emitted layout hits `layout === applied`? (emitted copy differs from applied; core's layoutsEqual no-op'd in setLayout).
  Authors must not use `track item` (object identity) — README.
tests (Angular unit-test builder -> vitest, happy-dom, TestBed, `vi.stubGlobal('requestAnimationFrame', undefined)` in beforeEach so core hit-tests synchronously; afterEach unstubAll + restoreAllMocks + setTimeout 0):
  grid.component.spec.ts: 'dash-grid': positions widgets; numeric inputs accept static attributes (+maxRows undefined); setting layout from outside re-renders w/o emitting; addItem append/emit, refused -> reject; removeItem; columns change emits normalized exactly once; columns+layout same tick; growing columns with wider layout same tick; addItem enforces maxRows vs normalized layout; drag e2e & after @for reorder; destroy mid-drag no ghost; re-id'd widget rebinds; 'core runs outside the Angular zone' (spies NgZone.runOutsideAngular).
   describe 'dash-grid with zone.js': TestBed providers provideZoneChangeDetection() + ComponentFixtureAutoDetect; asserts pointermoves during drag enter no Angular zone (zone.onUnstable count 0) and trigger no app ticks (afterEveryRender counter), with a positive control; drop emits.
  directives.spec.ts: data-grid-id follows input; data-grid-handle marker.
  Helper `create()` = TestBed.createComponent + `await fixture.whenStable()`.
README sections: # @dash-builder/angular / Install / Styles / Usage (+ rules bullets) / API (### `DashGrid` (`<dash-grid>`), ### `DashWidget` (`[dashWidget]`) and `DashHandle` (`[dashHandle]`), ### Adding widgets: use `addItem`) / Narrow view / Drop modes / License. Intro: "Requires Angular 22. Works with and without zone.js: the grid's DOM listeners run outside the Angular zone, and state flows through signals."
CHANGELOG.md lives at projects/grid-angular/CHANGELOG.md (shipped via ng-package assets).

## 4. packages/demo-kit (@dash-builder/demo-kit, private, 0.0.0)
package.json: "private":true,"type":"module","main":"./dist/index.js","types":"./dist/index.d.ts"; exports "." {types,import -> dist/index.{d.ts,js}}, "./theme.css","./blocks.css","./controls.css" -> ./dist/*.css; "sideEffects":["*.css"]; "files":["dist"];
 scripts: build "tsc -p tsconfig.build.json && node scripts/copy-css.mjs"; test "vitest run"; typecheck "tsc --noEmit -p tsconfig.json"; devDeps core workspace:*, typescript ^7.0.2, vitest ^5.0.5. (No framework deps; no test:smoke.)
 scripts/copy-css.mjs: mkdir dist; copyFileSync src/{theme,blocks,controls}.css -> dist/.
 tsconfig.json (noEmit, include src,test,vitest.config.ts) / tsconfig.build.json (rootDir src, outDir dist, declaration). vitest: environment 'node', include test/**/*.test.ts.
 src/index.ts exports: BLOCKS, CHART_POINTS, DEMO_LAYOUT, GRID_OPTIONS, blockInfo, nextBlockId (+types BlockInfo, BlockKind) from blocks.ts; MODES from modes.ts; SITE, docsLinks, siteConfig (+type SiteConfig) from site.ts.
 - blocks.ts: content-free DEMO_LAYOUT (8 LayoutItems, one `locked`), BLOCKS record id->{title,kind,accent,value?,items?}, GRID_OPTIONS {columns:4,rowHeight:72,gap:10}, CHART_POINTS string, blockInfo (Object.hasOwn fallback), nextBlockId (`new-N`).
 - modes.ts: MODES [{mode,label,hint}] x4 (hints mirror core README "Drop modes").
 - site.ts: SITE {name:'dash-builder'}; siteConfig(env:{GITHUB_REPOSITORY?,SHOW_NPM?}) -> {name, base: '/<repo>/' or '/', repoUrl, showNpm: env.SHOW_NPM==='1'}; docsLinks(repoUrl) -> blob/main README links (core, angular at packages/angular/projects/grid-angular/README.md, react).
 - theme.css (:root --site-* tokens, --dash-marker-color, --dash-placeholder-border), blocks.css (block content, each block sets --block-accent), controls.css (focus ring, `.segmented` / `.segmented__option` mode switch, `.hero-hint`).
 test/demo-kit.test.ts: layout/blocks invariants (unique ids, one locked, only id/w/h/minW/minH/locked keys, fallbacks), GRID_OPTIONS+CHART_POINTS, MODES order/labels/one-sentence hints, siteConfig/docsLinks.
 Consumption: site (vite/TS imports '@dash-builder/demo-kit'; CSS via `@import '@dash-builder/demo-kit/theme.css'` in site/src/shared.css), Angular site-demo (styles.css `@import`s core grid.css + demo-kit theme/blocks/controls css), React site app (site/react/app.tsx imports demo-kit; react block.tsx). packages/react/demo does NOT use demo-kit (own blocks.ts/styles). Angular `demo` does not either. demo-kit must be built (dist) before consumers: pnpm -r topological order handles it via devDep workspace:*.

## 5. site/ (@dash-builder/site, private, 0.0.0, "type":"module")
scripts: dev "vite"; build:site "node scripts/build.mjs"; check "node scripts/check-dist.mjs"; preview "vite preview"; test "vitest run"; typecheck "tsc --noEmit -p tsconfig.json". (No `build` script -> `pnpm -r build` skips it; built only via build:site.)
devDeps: @dash-builder/{angular-workspace,core,demo-kit,react} workspace:*, @testing-library/{dom ^10.4.2, react ^16.3.3}, @types/react ^19.3.0, @types/react-dom ^19.3.0, @vitejs/plugin-react ^6.1.2, happy-dom ^21.0.4, react ^19.3.1, react-dom ^19.3.1, typescript ^7.0.2, vite ^8.3.5, vitest ^5.0.5.
vite.config.ts: base: site.base (from demo-kit siteConfig(process.env)); define {__SITE__: JSON.stringify(site)}; plugins [siteName() (transformIndexHtml order 'pre' replaces %SITE_NAME% with SITE.name), react()]; build.rollupOptions.input {main: ./index.html, react: ./react/index.html}  (multi-page; NO aliases).
vitest.config.ts: define __SITE__ = siteConfig({}); environment happy-dom; include test/**/*.test.{ts,tsx}; environmentOptions.happyDOM.settings {enableIframePageLoading:true, navigation:{disableChildFrameNavigation:true}}.
tsconfig.json: extends ../tsconfig.base.json; rootDir "..", noEmit, jsx react-jsx, module ESNext, moduleResolution Bundler, types ["vite/client"]; include src, react, test, vite.config.ts, vitest.config.ts.
src/env.d.ts: `declare global { const __SITE__: SiteConfig }`; src/config.ts: `export const site: SiteConfig = __SITE__;`
Structure: index.html (landing: header nav with #demo/#features/#frameworks, optional #nav-docs/#nav-github `hidden` links, <main> with three empty sections filled by TS, <footer id=footer>, `<script type=module src="/src/main.ts">`); react/index.html (div#root + ./main.tsx); react/main.tsx (StrictMode, imports '@dash-builder/core/grid.css', '../src/shared.css', './app.css').
src/: main.ts (wires brand, nav links, mountFeatures/mountHero/mountFrameworks/mountFooter), hero.ts (vanilla hero grid), frameworks.ts (tab UI), features.ts, snippets.ts (SNIPPETS per framework + highlight), blocks-dom.ts (vanilla block renderer), mode-switch.ts (vanilla segmented ARIA radiogroup), footer.ts (copy buttons, links, npm links when showNpm), shared.css (`@import '@dash-builder/demo-kit/theme.css'` + base rules), styles.css (777 lines).
react/: app.tsx (ModeSwitch + <Grid {...GRID_OPTIONS} layout onLayoutChange dropMode> + caption "Built with @dash-builder/react"), block.tsx, app.css, main.tsx, index.html.
Tabs (src/frameworks.ts): TABS = vanilla 'Vanilla JS', angular 'Angular', react 'React'. ARIA tablist (roving tabindex, ArrowLeft/Right/Home/End). Every panel has a code block (highlighted snippet + copy button). Vanilla demo is mounted in-page (createGrid + createModeSwitch). Angular and React demos are IFRAMES created lazily on first tab activation: `frame.src = \`${site.base}${framework}/\``, `loading=lazy`, class demo-frame, title "<Framework> demo". So landing never loads Angular/React until their tab opens.
No theme toggle exists in site (no data-theme/dark mode; only theme.css tokens). Mirror demos share identical blocks via demo-kit; the three (hero, Vanilla, Angular, React) must look identical.
scripts/build.mjs: base from siteConfig(process.env); rm site/dist and packages/angular/dist/site-demo; `pnpm exec vite build` (asserts dist/react/index.html); then `pnpm --filter @dash-builder/angular-workspace exec ng build site-demo --base-href ${base}angular/` (asserts packages/angular/dist/site-demo/browser/index.html); cpSync that `browser` dir -> site/dist/angular; writeFileSync site/dist/.nojekyll.
scripts/check-dist.mjs: requires dist/{index.html,react/index.html,angular/index.html,.nojekyll}; for each page parses src/href attrs: absolute paths must start with base and exist under dist; relative must exist (dir => index.html); angular/index.html must contain `<base href="${base}angular/">`; the landing JS bundle (dist/assets/*.js) must contain inlined `base:"<base>"` literal and the 'angular'/'react' iframe path segment strings.
tests: test/frameworks.test.ts (tabs ARIA/keyboard, lazy iframe src with base), test/features.test.ts (features, snippets, footer), test/hero.test.ts (hero grid behaviour), test/react-app.test.tsx (React tab app in StrictMode: 8 widgets in DEMO_LAYOUT order, handle on map block, radiogroup updates hint, arrow keys, caption/no add-remove; console.error spy must stay silent).
Deploy: pages.yml (above); base path /<repo>/ from GITHUB_REPOSITORY; SHOW_NPM=1 only in pages.yml; local: `export GITHUB_REPOSITORY=Constantine-24/dash-builder; pnpm build:site && pnpm --filter @dash-builder/site preview`.

## 6. Core-side conventions wrappers rely on (packages/core)
core exports (src/index.ts): types DropMode, DropResult, DropTarget, EngineConfig, LayoutItem, PlacedItem, RejectReason; functions layoutsEqual, normalizeLayout, computeFlow, rowsOf, stackForNarrow, totalRows, planDrop, planResize, addItem, removeItem, createGrid; types GridController, GridOptions. smoke test asserts the EXACT export key list.
core package.json: type module, main/types/exports {".":{types,import}, "./grid.css":"./dist/grid.css"}, sideEffects ["*.css"], build "tsc -p tsconfig.build.json && node scripts/copy-css.mjs", devDeps happy-dom, typescript ^7.0.2, vitest ^5.0.5; vitest env 'node' (dom tests use happy-dom via per-file/dir config).
GridOptions { columns; layout; dropMode?='insert'; maxRows?; rowHeight?=80; gap?=8; breakpoint?=640; onLayoutChange?(layout); onReject?(reason); ghost?(el)=>HTMLElement }
GridController { setLayout(layout); setOptions(Partial<Omit<GridOptions,'layout'>>); addItem(item,index?): DropResult; removeItem(id); getLayout(); refresh(); destroy() }
 - `update(patch)` == `setOptions(partial)`; layout set separately via setLayout (no-op if layoutsEqual); changing a geometry key (GEOMETRY_KEYS = columns, dropMode, maxRows, breakpoint, rowHeight, gap) cancels active drag/resize and `setOptions` skips equal values; columns change may normalize layout and emit onLayoutChange.
 - DOM contract: container gets class `dash-grid`, inline display:grid, a `.dash-marker` child; widgets = direct children with `data-grid-id`; handle = `data-grid-handle` attr; opt-out `data-grid-no-drag`; per-item CSS vars `--dash-col`, `--dash-row`; `dash-item` class added on bind; scan() on refresh binds/unbinds (first duplicate id wins).
 - Wrappers do NOT use controller.addItem/removeItem; they use the pure planners (addItem/removeItem/normalizeLayout) and emit through their own state.
 - Wrappers re-export LayoutItem, DropMode, RejectReason, DropResult types from core.
 - Core callbacks are held in closure at create time -> wrappers pass trampolines.
 - Grid CSS is shipped by core only (`@dash-builder/core/grid.css`), consumers import once; wrappers ship no CSS.

## 7. Release prep
- CHANGELOG.md per published package (core, react, angular inner dir), written by Changesets; 0.1.0 entry: "First public release: ..." via changeset id 37f3acf. `files` includes CHANGELOG.md (core/react); Angular via ng-package assets.
- LICENSE: each package carries a byte-identical copy of root LICENSE (checked by ci.yml `cmp` loop and required by pack:check ALWAYS list).
- No RELEASING.md; release docs in CONTRIBUTING.md "Releases" + "First publish (maintainer, once)" + "GitHub Pages (once)":
  * fixed/lockstep versions; pre-1.0 semver (breaking = minor).
  * Peer range on core `workspace:0.x` (published `0.x`) + `onlyUpdatePeerDependentsWhenOutOfRange`; do NOT use `workspace:^` pre-1.0 (^0.1.0 excludes 0.2.0, changesets would force a major bump); at 1.0 become `workspace:^`. Run `pnpm changeset status --verbose` after touching config.
  * Angular publishes from packages/angular/dist/grid-angular via publishConfig.directory; pnpm rewrites workspace: ranges at pack time; pack:check proves it.
  * Version Packages PR is opened with GITHUB_TOKEN so shows no CI checks; `pnpm release` reruns build+test+pack:check before publish.
  * First publish by hand (trusted publisher can only be added to existing packages): merge first Version PR -> release.yml fails at publish with npm auth error (expected) -> locally `npm login` (org account), `pnpm build && pnpm changeset publish`, `git push --follow-tags` -> on npmjs.com each package Settings -> Trusted Publisher: owner Constantine-24, repo dash-builder, workflow release.yml, no environment, allow npm publish -> afterwards OIDC + provenance (NPM_CONFIG_PROVENANCE=true).
- Repo metadata in every package.json: homepage = GitHub Pages URL, repository.directory, bugs.url, keywords; publishConfig.access public.
- Commit style: Conventional Commits; release commit "chore(release): version packages (#N)".
- Dependabot as above. PR template + issue templates in .github.

## 8. Gotchas / notable comments
- Build order: tests import built dist (`pnpm build` first). Angular lib test imports @dash-builder/core dist too.
- Angular: zone.js is kept as devDependency only for the zone spec; unit-test builder auto-loads it and adds zone CD, so test-providers.ts forces zoneless; zone spec opts back in. No `zone.js` in peerDeps. Library works with and without zone.js (core listeners via runOutsideAngular; state via signals).
- Angular workspace pinned TS ~6.0.x (dependabot ignores TS major); other packages TS ^7.0.2.
- Angular @angular/build and @angular/cli exact-pinned "22.2.4" while others ^22.2.0.
- ng-packagr output is ESM-only (fesm2022 + types/); attw profile esm-only for all three; core excludes grid.css entrypoint from attw.
- Smoke for Angular must `import '@angular/compiler'` first (partial compilation needs JIT linker in plain Node).
- Angular lib built with `compilationMode: partial` in prod tsconfig only.
- pnpm-workspace.yaml must list the inner Angular manifest explicitly, else Changesets/pnpm won't version/publish it.
- ng test needs `vi.stubGlobal('requestAnimationFrame', undefined)` because core hit-tests via rAF otherwise.
- Don't `track item` in @for / key by identity: core emits copies of items.
- Widgets must be direct children of the grid (React: Widget elements, wrappers OK; Angular: no ngTemplateOutlet / wrapper templates).
- React: StrictMode double-mount handled by effect create/destroy; test 'StrictMode: one controller'; React renders `dash-grid` + `display:grid` and `dash-item` itself since className/style rewrites would drop core's imperative changes; Widget requests refresh (coalesced microtask) after every commit/unmount; known leftover: className change mid-drag drops drag-state classes.
- React: `dangerouslySetInnerHTML` on Widget unsupported (core resize handle); `<Grid hidden>` still visible (display:grid forced).
- Peer range pitfalls (see §7); first-publish bootstrap (see §7).
- Site: Angular + React demos are iframes (hero must not wait for them); site check verifies base-prefix correctness; `<owner>.github.io` repos still get /<repo>/ base by design.
- Docs under docs/superpowers/{specs,plans} contain design spec + per-package plans (grid-core, grid-react, grid-angular, demo-site) — useful templates for the plan format; note the demo-site spec still says "@grid-master/*" (old name).
