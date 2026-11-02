// Run with `pnpm test:hooks` (node --test). CI runs it too.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK = path.join(__dirname, 'block-raw-tooling.js');

/** `input` is a command, or `{ raw }` for a payload sent as is. */
const run = (input, cwd = ROOT) => {
  const payload =
    typeof input === 'string' ? JSON.stringify({ tool_input: { command: input }, cwd }) : input.raw;
  const result = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  return { status: result.status, stderr: result.stderr };
};

const expectBlocked = (command, reason, cwd) => {
  const { status, stderr } = run(command, cwd);
  assert.equal(status, 2, `expected a block: ${command}`);
  assert.match(stderr, reason, `wrong reason for: ${command}`);
};

const expectAllowed = (command, cwd) => {
  const { status, stderr } = run(command, cwd);
  assert.equal(status, 0, `expected allowed: ${command}\n${stderr}`);
};

const PUBLISH = /Publishing is blocked/;
const TAGS = /Pushing tags is blocked/;
const INSTALL = /pnpm workspace/;
const VITEST = /Direct `vitest` is blocked/;

describe('block-raw-tooling: publishing', () => {
  for (const command of [
    'npm publish',
    'npm pub',
    'npm unpublish @scope/pkg-core@0.1.0',
    'npm dist-tag add @scope/pkg-core@0.1.0 latest',
    'npm deprecate "@scope/pkg-core@0.0.0-stage" "Placeholder build"',
    'npm undeprecate @scope/pkg-core@0.0.0-stage',
    'pnpm exec npm deprecate @scope/pkg-core@0.1.0 "Broken"',
    'pnpm publish',
    'pnpm -r publish',
    'pnpm --filter x publish',
    'pnpm -F @scope/pkg-core publish',
    'pnpm -C packages/core publish',
    'pnpm --dir packages/core publish',
    'npm -w x publish',
    'npm --workspace x publish',
    'npm --prefix packages/core publish',
    'npm publish --access public',
    'pnpm release',
    'pnpm run release',
    'pnpm run-script release',
    'npm run release',
    'npm run-script release',
    'yarn release',
    'changeset publish',
    'npx changeset publish',
    'npx --yes changeset@latest publish',
    'npx @changesets/cli publish',
    'pnpm changeset publish',
    'pnpm exec changeset publish',
    'pnpm exec -- changeset publish',
    'pnpm --filter x exec changeset publish',
    'pnpm run changeset publish',
    'npm run changeset -- publish',
    'pnpm dlx @changesets/cli publish',
    'pnpm exec npm publish',
    'pnpm -r exec npm publish',
    'npx npm publish',
    'node node_modules/@changesets/cli/bin.js publish',
    './node_modules/.bin/changeset publish',
    '/usr/local/bin/npm publish',
    'sudo npm publish',
    'timeout 60 npm publish',
    'nice -n 5 npm publish',
    'env -i PATH=/usr/bin npm publish',
    'NPM_TOKEN=x npm publish',
    'corepack pnpm publish',
    'xargs npm publish',
    'command npm publish',
    'pnpm build && pnpm changeset publish',
    'pnpm build; npm publish',
    'true || npm publish',
    'if true; then npm publish; fi',
    '{ npm publish; }',
    '(cd packages/core && npm publish)',
    'echo $(npm publish)',
    'bash -c "npm publish"',
    "sh -c 'pnpm publish'",
    "zsh -lc 'cd packages/core && npm publish'",
    'eval "npm publish"',
    'npm \\\n  publish',
    'pnpm \\\n  --filter x \\\n  publish',
    'echo "it\'s" && npm publish && echo "that\'s"',
    'cd packages/core && bash -c "npm publish"',
    "bash <<'EOF'\nnpm publish\nEOF",
    "bash -s <<'EOF'\nnpm publish\nEOF",
    "cat <<'EOF' | bash\nnpm publish\nEOF",
    'npm publish>/dev/null',
    'npm publish 2>&1 | tee log',
    'echo "$(npm publish)"',
    'pnpm -w release',
    'pnpm -w publish',
    'pnpm --workspace-root release',
    'npm --loglevel silent publish',
    'bun publish',
    'bun run release',
    'pnpx changeset publish',
    'yarnpkg publish',
    '\\npm publish',
    'sudo -u bob npm publish',
    'timeout -s KILL 60 npm publish',
    'watch -n 5 npm publish',
    'find packages -maxdepth 1 -type d -exec npm publish {} \\;',
    // npm resolves unique abbreviations and aliases (`lib/utils/cmd-list.js`).
    'npm pu',
    'npm publ',
    'npm publis --access public',
    'npm unp @scope/pkg-core@0.1.0',
    'npm unpub @scope/pkg-core@0.1.0',
    'npm dep @scope/pkg-core@0.1.0 "Broken"',
    'npm depr @scope/pkg-core@0.1.0 "Broken"',
    'npm dist-tags add @scope/pkg-core@0.1.0 latest',
    'npm exe changeset publish',
    'npm ru release',
    // Wrappers and shells given by path, and `--` before the `-c` script.
    '/usr/bin/env npm publish',
    '/usr/bin/sudo npm publish',
    "bash -c -- 'npm publish'",
    // A `<<` that never finds its delimiter line is not a heredoc: later lines still run.
    'pnpm test -- --filter "a<<b"\nnpm publish',
    'echo $((1<<2))\nnpm publish',
  ]) {
    it(`blocks ${command}`, () => expectBlocked(command, PUBLISH));
  }
});

describe('block-raw-tooling: tags', () => {
  for (const command of [
    'git push --tags',
    'git push origin --tags',
    'git push --follow-tags',
    'git push origin refs/tags/v1.0.0',
    'git push origin @scope/pkg-core@0.1.0',
    'git push origin v1.0.0',
    'pnpm changeset tag',
    'npx changeset tag',
    'pnpm -w changeset tag',
    'pnpm changeset git-tag',
    'npx @changesets/cli git-tag',
    'git push origin \\\n  --tags',
    'git push \\\n  origin v0.2.0',
    'git push --mirror',
    'git push origin +refs/tags/v1.0.0',
    'git push origin :refs/tags/v1.0.0',
    'git -c push.followTags=true push',
    'git -c core.sshCommand=ssh push --tags',
    'gh release create v0.2.0 --generate-notes',
  ]) {
    it(`blocks ${command}`, () => expectBlocked(command, TAGS));
  }
});

describe('block-raw-tooling: package managers', () => {
  for (const command of [
    'npm install',
    'npm i lodash',
    'npm ci',
    'npm uninstall x',
    'npm update',
  ]) {
    it(`blocks ${command}`, () => expectBlocked(command, INSTALL));
  }
  for (const command of ['yarn', 'yarn install', 'yarn add x', 'yarn test']) {
    it(`blocks ${command}`, () => expectBlocked(command, INSTALL));
  }
});

describe('block-raw-tooling: vitest in the Angular workspace', () => {
  const angular = path.join(ROOT, 'packages', 'angular');
  for (const command of [
    'vitest run',
    'pnpm vitest run',
    'pnpm exec vitest run',
    'npx vitest run',
    'pnpm dlx vitest run',
  ]) {
    it(`blocks ${command} inside packages/angular`, () => expectBlocked(command, VITEST, angular));
  }
  for (const command of [
    'cd packages/angular && pnpm exec vitest run',
    'cd "packages/angular" && pnpm exec vitest run',
    'pushd packages/angular && pnpm exec vitest run',
    'pnpm -C packages/angular exec vitest run',
    'pnpm --dir packages/angular exec vitest run',
    'pnpm --filter pkg-angular-workspace exec vitest run',
    'pnpm -F ./packages/angular exec vitest run',
    'pnpm --filter pkg-angular-workspace \\\n  exec vitest run lib/pkg.spec.ts',
    'npx vitest run packages/angular/projects/pkg/src/lib/pkg.spec.ts',
    'npx vitest packages/angular/projects/pkg/src/lib/pkg.spec.ts --run',
    'pnpm vitest run packages/angular',
    'npx vitest run --root packages/angular',
    'npx vitest run --root=packages/angular',
    'pnpm -r exec vitest run',
    'pnpm --recursive exec vitest run',
    "pnpm --filter './packages/**' exec vitest run",
    "pnpm --filter '{packages/angular}' exec vitest run",
    "pnpm --filter '@scope/pkg-angular...' exec vitest run",
    "cd packages/angular && bash -c 'npx vitest run'",
    'echo "it\'s" && cd packages/angular && npx vitest run && echo "ok\'"',
  ]) {
    it(`blocks ${command} from the root`, () => expectBlocked(command, VITEST));
  }
});

describe('block-raw-tooling: allowed', () => {
  for (const command of [
    'pnpm build',
    'pnpm test',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm format:check',
    'pnpm pack:check',
    'pnpm install',
    'pnpm install --frozen-lockfile',
    'pnpm add -D x --filter pkg-angular-workspace',
    'pnpm changeset',
    'pnpm changeset status --verbose',
    'pnpm version-packages',
    'pnpm test:hooks',
    "pnpm --filter @scope/pkg-core exec vitest run src/controller.spec.ts -t 'name'",
    'pnpm --filter @scope/pkg-react exec vitest run',
    'cd packages/angular && pnpm ng test --watch=false',
    'cd packages/angular && pnpm ng test --watch=false --include lib/pkg.spec.ts',
    'npm view @scope/pkg-core version',
    'npm pack --dry-run',
    'npm --version',
    'git commit -m "docs: explain npm publish and pnpm release"',
    "git commit -m 'chore: yarn and npm install notes'",
    'git push -u origin main',
    'git push origin feat/release-notes',
    'git tag --list',
    'git log --oneline',
    'echo publish',
    "cat <<'EOF'\nnpm publish\nEOF",
    'grep -rn "npm publish" .claude',
    "grep -rnE 'npm|yarn' .claude",
    'grep -rnE "npm|yarn" .',
    "rg -n 'pnpm|yarn' docs",
    "git log --grep='npm|yarn' --oneline",
    "sed -i '' 's|npm|pnpm|g;s|yarn|pnpm|g' README.md",
    "grep -E 'publish;|yarn' x",
    "git commit -m 'npm;yarn'",
    "gh pr create --title \"fix: don't over-block\" --body 'Allows grep; yarn stays blocked'",
    'git commit -m "$(cat <<\'EOF\'\nchore: npm publish \"notes\"; yarn\nEOF\n)"',
    'git push origin v0.3-docs',
    'git push origin 2.0-prep',
    'git push origin release/0.2.x',
    'git push --force-with-lease origin feat/x',
    'git fetch --tags',
    'git ls-remote --tags origin',
    'git tag -l',
    'command -v yarn',
    'command -v npm && npm --version',
    'npm dist-tag ls @scope/pkg-core',
    'npm help publish',
    'npm help deprecate',
    'npm deprecate --help',
    'npm dist-tags ls @scope/pkg-core',
    'npm un x --help',
    'npm docs @scope/pkg-core',
    'npm pkg get version',
    'pnpm help publish',
    'npm publish --help',
    'pnpm --filter @scope/pkg-core exec vitest run src/controller.spec.ts -t "publish"',
    'pnpm --filter @scope/pkg-core build',
    'pnpm -w add -D x',
    'node scripts/pack-check.mjs',
    'npm ls',
    'npx prettier --check .',
    'ls packages/core/release',
    'cat .github/workflows/release.yml',
    "awk '/release/ { print }' CLAUDE.md",
    "cat <<'EOF'\nyarn add x; npm publish\nEOF",
    '',
  ]) {
    it(`allows ${JSON.stringify(command)}`, () => expectAllowed(command));
  }
  it('stays fast on an unterminated heredoc', () => {
    const started = Date.now();
    expectAllowed('cat <<' + 'A'.repeat(2000) + '\n' + '\n'.repeat(5000));
    expectAllowed('cat <<EOF\n' + '\n'.repeat(40000));
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });
  it('stays fast on many heredocs sharing one delimiter', () => {
    const started = Date.now();
    expectAllowed('cat ' + '<<A '.repeat(20000) + '\n' + 'A\n'.repeat(20000));
    assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
  });
  it('allows vitest in core', () =>
    expectAllowed('pnpm exec vitest run', path.join(ROOT, 'packages', 'core')));
});

describe('block-raw-tooling: fails closed', () => {
  it('blocks an unreadable payload', () => {
    const { status, stderr } = run({ raw: '{not json' });
    assert.equal(status, 2);
    assert.match(stderr, /unreadable hook payload/);
  });
  it('blocks a payload without tool_input.command', () => {
    const { status, stderr } = run({ raw: JSON.stringify({ tool_input: { cmd: 'npm publish' } }) });
    assert.equal(status, 2);
    assert.match(stderr, /no tool_input\.command/);
  });
});
