# Contributing

Thanks for your interest in improving **stack-weaver**! Bug reports, docs fixes and pull requests are all welcome.

## Getting started

```bash
git clone https://github.com/mellowforge/stack-weaver.git
cd stack-weaver
nvm use               # Node version from .nvmrc
corepack enable       # pnpm version from package.json "packageManager"
pnpm install
pnpm build
```

## Project layout

| Path                                                 | What                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/core/`                                     | `@mellowforge/stack-weaver-core`: the framework-agnostic editor (document model, formats, visual and code panes) |
| `packages/react/`                                    | `@mellowforge/stack-weaver-react`: the React wrapper                                                          |
| `packages/angular/projects/stack-weaver-angular`     | `@mellowforge/stack-weaver-angular`: the Angular wrapper (in an Angular CLI workspace, with the `site-demo` app) |
| `packages/demo-kit/`                                 | Private: fixtures, recipes and theme shared by the demo site's editors, and the test code editor  |
| `site/`                                              | The demo site, deployed to GitHub Pages                                                           |

## Development loop

```bash
pnpm build                               # the tests import each package's built dist
pnpm test                                # everything
pnpm typecheck
pnpm test:smoke                          # each built wrapper loads through its exports
pnpm pack:check                          # tarball contents, workspace: ranges, type resolution
node packages/core/scripts/check-entry.mjs   # the core entry stays free of schemas and CodeMirror
node packages/core/scripts/check-types.mjs   # no `yaml` type reaches the core's public .d.ts files
pnpm --filter stack-weaver-site dev     # the demo site with hot reload
```

## Demo site

`site/` is the GitHub Pages demo and the only demo app: a landing page with Vanilla JS, React and Angular tabs showing
the same editor (the Angular app is served from `/angular/`, the React app from `/react/`). Build and preview it
locally:

```bash
export GITHUB_REPOSITORY=mellowforge/stack-weaver
pnpm build:site && pnpm --filter stack-weaver-site preview
```

`pnpm build:site` builds all packages, assembles `site/dist` and runs a dist check. Environment variables:

- `GITHUB_REPOSITORY=<owner>/<repo>`: base path `/<repo>/` and the GitHub links (set automatically by GitHub Actions; without it the base is `/`).
- `SHOW_NPM=1`: show the npm links (once the packages are on npm).

## Pull requests

1. Open an issue first for anything beyond a small fix, so we can agree on the API.
2. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
3. Write a failing test first. A change to one wrapper comes with the same change in the other, and the test names match where the behaviour matches.
4. Add a changeset (`pnpm changeset`) for any user-visible change to a published package.
5. Use [Conventional Commits](https://www.conventionalcommits.org/) (`fix(core): …`, `feat(react): …`).

Wrappers contain only wiring: editor behaviour belongs in the core. CI must be green (build, core graph checks, type-check, tests, smoke tests, package check, site build) before merge.

## Releases

Releases are automated with [Changesets](https://github.com/changesets/changesets) from `.github/workflows/release.yml`. Pushing to `main` with pending changesets opens or updates a "Version Packages" PR that bumps versions and writes each package's `CHANGELOG.md`; merging that PR publishes to npm with provenance, through npm trusted publishing (no npm token is stored).

- **Lockstep versions:** `@mellowforge/stack-weaver-core`, `@mellowforge/stack-weaver-angular` and `@mellowforge/stack-weaver-react` are `fixed` in `.changeset/config.json`, so every release moves all three to the same version. They start at `0.0.0`, and `.changeset/first-release.md` takes them to `0.1.0`.
- **Pre-1.0 semver:** breaking changes are a minor bump (with migration notes), features minor, fixes patch.
- **Peer range on core:** the wrappers declare `workspace:0.x` (published as `0.x`), together with `onlyUpdatePeerDependentsWhenOutOfRange`. Don't change it to `workspace:^`: pre-1.0, `^0.1.0` excludes `0.2.0` and Changesets would answer with a major bump. Run `pnpm changeset status --verbose` after touching the config. At 1.0 the range becomes `workspace:^`.
- `@mellowforge/stack-weaver-angular` publishes from `packages/angular/dist/stack-weaver-angular` (`publishConfig.directory`); pnpm rewrites `workspace:` ranges at pack time, and `pnpm pack:check` proves it.
- Each package carries a byte-identical copy of the root `LICENSE` (CI compares them).
- The Version Packages PR is opened with `GITHUB_TOKEN`, so `ci.yml` does not run on it and it shows no CI checks; `pnpm release` re-runs the build, tests, core graph checks and `pack:check` before publishing. Required status checks on `main` would therefore block that PR: if you add them, let `release.yml` open the PR with a GitHub App token or a PAT instead, so CI runs on it.

### First publish (maintainer, once)

npm trusted publishers can only be added to packages that already exist, so the first version is published by hand:

1. Merge the first "Version Packages" PR (it takes all three packages to 0.1.0). The `release.yml` run on that merge **fails at the publish step with an npm auth error**; that is expected and is the signal for step 2.
2. Locally, on an up-to-date `main`: `npm login` (an account in the `mellowforge` npm org), then `pnpm build && pnpm changeset publish`, then `git push --follow-tags` so GitHub gets the release tags it created.
3. On npmjs.com, for each package → Settings → Trusted Publisher: GitHub owner `mellowforge`, repository `stack-weaver`, workflow `release.yml`, no environment, allow `npm publish`.
4. From then on, `release.yml` publishes through OIDC with provenance.
5. In the repository **Settings → Secrets and variables → Actions → Variables**, add `SHOW_NPM` with the value `1`, so the demo site shows the npm links from its next deploy (see below).

### GitHub Pages (once)

In the repository **Settings → Pages**, set **Source: GitHub Actions**. `.github/workflows/pages.yml` then deploys the demo site on every push to `main`. The site build step in `pages.yml` passes the repository variable `SHOW_NPM` to the build: the deployed site shows the npm links only once that variable is `1`, which you set after the first publish (step 5 above).
