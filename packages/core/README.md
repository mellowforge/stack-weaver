# @stack-weaver/core

Framework-agnostic core of stack-weaver, a schema-driven editor for Kubernetes and docker-compose YAML.

## Install

```sh
pnpm add @stack-weaver/core
```

The package is ESM-only (`"type": "module"`): use `import`, not `require`.

## Development

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
