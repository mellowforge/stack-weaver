# Releases

Releases go through Changesets and `.github/workflows/release.yml`; CONTRIBUTING.md ("Releases") has the full process.

- **Agents never publish.** Never run `npm publish`, `pnpm publish`, `changeset publish` or `pnpm release`; never
  `npm unpublish`, `npm deprecate` or change a `dist-tag`; never push tags (`git push --tags`, `--follow-tags`, a tag
  ref), run `changeset tag` or `gh release create`. `.claude/hooks/block-raw-tooling.js` blocks these; a blocked
  command means "hand it to the maintainer", not "find another spelling". Give the maintainer the exact commands.
- **Every user-facing change gets a changeset**: `pnpm changeset`, listing all three packages (they are `fixed`
  together). Pre-1.0: a breaking change is a minor bump (with migration notes), a feature minor, a fix patch. Docs,
  tests, CI and the demo site need none.
- **The peer range on core stays `workspace:0.x`** in both wrappers until 1.0. `workspace:^` would make Changesets
  answer a 0.x minor with a major bump. After touching `.changeset/config.json`, run `pnpm changeset status --verbose`.
- **Gates.** `pnpm release` runs build, typecheck, tests, smoke tests, the core graph checks and `pnpm pack:check`
  before it publishes, because the Version Packages PR gets no CI. Keep it in step with `ci.yml`.
- **Tarballs.** `pnpm pack:check` packs each package as publish would (Angular from
  `packages/angular/dist/stack-weaver-angular`) and fails on missing outputs, sources or specs in the tarball, leftover
  `workspace:` ranges, a LICENSE that differs from the root, or an attw problem.
- **`main` is protected**: changes land through a PR with green CI, squash- or rebase-merged. Agents push a branch,
  open the PR and stop at green CI; the maintainer merges. The Version Packages PR has no CI and is merged by an admin
  through the ruleset bypass.
- **A failed or partial release** (some packages published, one not): fix the cause, then the maintainer re-runs the
  failed Release run; `changeset publish` skips versions already on npm. Check tags with `git ls-remote --tags origin`.
- **A new package** needs one publish by hand before trusted publishing can be set up: CONTRIBUTING.md, "First
  publish of a new package".
