# @stack-weaver/core

Framework-agnostic core of stack-weaver, a schema-driven editor for Kubernetes and docker-compose YAML.

## Install

```sh
pnpm add @stack-weaver/core
```

The package is ESM-only (`"type": "module"`): use `import`, not `require`.

## Formats are opt-in

The main entry has no schemas. Import a format from its subpath and register it, so only the
formats you use are bundled (each Kubernetes kind's schema is a lazy chunk on top of that):

```ts
import { detectFormat, parseText, registerFormat, validateText } from '@stack-weaver/core';
import { kubernetesFormat } from '@stack-weaver/core/formats/kubernetes';
import { composeFormat } from '@stack-weaver/core/formats/compose';

registerFormat(kubernetesFormat);
registerFormat(composeFormat);

const parsed = parseText(text);
const format = detectFormat(parsed);
const problems = format ? await validateText(parsed, format) : [];
```

## Development

The first `test`, `build` or `typecheck` downloads the pinned upstream schemas (cached in
`.cache/` afterwards), so it needs network access to `raw.githubusercontent.com`. Re-pinning with
`--update-lock` also lists files through the GitHub API: with the `gh` CLI when it is installed,
otherwise with `fetch`, authenticated by `GITHUB_TOKEN` when set.

### Updating the pinned schemas

The Kubernetes and compose schemas are generated from upstream sources pinned by URL and sha256 in
`schema-sources.lock.json`. A normal `test`, `build` or `typecheck` only reads the lockfile and
fails if a pin is missing or does not match. To move to another version:

1. Change `TAG` in `scripts/gen-kubernetes.mjs` or `COMMIT` in `scripts/gen-compose.mjs` (and the
   matching `version` in `src/formats/kubernetes/index.ts` or `src/formats/compose/index.ts`).
2. Run `node scripts/gen-kubernetes.mjs --update-lock` or `node scripts/gen-compose.mjs --update-lock`
   to download the new sources and re-pin them.
3. Review and commit the `schema-sources.lock.json` diff together with the version change.

## License

MIT
