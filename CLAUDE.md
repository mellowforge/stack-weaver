# stack-weaver

A schema-driven visual and code editor for Kubernetes and docker-compose YAML: `@mellowforge/stack-weaver-core` with
React and Angular wrappers, a private `stack-weaver-demo-kit` and the demo site in `site/`. See README.md and
CONTRIBUTING.md.

## Commands

This is a pnpm workspace: use `pnpm`, never npm or yarn, for dependencies.

- `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm test:smoke`, `pnpm pack:check`, `pnpm build:site`
- One core or React test file: `pnpm exec vitest run <file>` in `packages/core` or `packages/react`.
- One Angular spec: `pnpm ng test stack-weaver-angular --watch=false --include <spec>` (or `site-demo`) in
  `packages/angular`. Never run `vitest` directly there: the specs need the TestBed environment `ng test` builds.
- `pnpm test:hooks` tests the agent guard-rail hook.

## Rules

@.claude/rules/release.md
