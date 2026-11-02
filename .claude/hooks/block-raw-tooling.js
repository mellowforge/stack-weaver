#!/usr/bin/env node
/**
 * PreToolUse hook for Bash. Tests: `pnpm test:hooks` (block-raw-tooling.test.js).
 *
 * Blocks four kinds of command that are wrong in this repository:
 *   - npm dependency commands and any yarn command: this is a pnpm workspace (`workspace:`
 *     protocol, `pnpm-lock.yaml`); npm or yarn would write a stray lockfile and break the links.
 *   - publishing: releases go through Changesets in CI (`.claude/rules/release.md`). An agent
 *     never runs `npm publish` / `pnpm publish` / `changeset publish` / the `release` script, nor
 *     changes published versions (`npm unpublish`, `npm deprecate`, `npm dist-tag add|rm`), in
 *     any common spelling (flags, runners, wrappers like `sudo`, `bash -c '…'`, heredocs fed to
 *     a shell, line continuations).
 *   - pushing tags (`git push --tags`, a tag ref, `changeset tag` / `git-tag`,
 *     `gh release create`): tags come from the release.
 *   - `vitest` aimed at the Angular workspace (`packages/angular`): its specs need the TestBed
 *     environment that only `ng test` (`@angular/build:unit-test`) builds. In `packages/core`
 *     and `packages/react`, `pnpm exec vitest run <file>` is the documented single-file command.
 *
 * The command line is lexed like a shell would (quotes, escapes, continuations, operators,
 * redirects), so quoted text — commit messages, grep patterns — never counts as a command.
 * A hook is a guard rail, not a sandbox: the real control is npm-side (trusted publishing with
 * tokens disallowed, see release.md). It fails closed: an unreadable payload blocks. Not covered:
 * other registry settings (`npm access`, `npm owner`) and tags created through the GitHub API
 * (`gh api …/git/refs`, `gh release edit --draft=false`).
 *
 * Exit codes: 0 — allow; 2 — block (stderr is shown to the agent as the reason).
 *
 * Registered in .claude/settings.json (PreToolUse, matcher Bash); CI runs its tests (`pnpm test:hooks`).
 * From the npm-release skill's template; the Angular rule points at this repo's two `ng test` projects.
 */

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const ANGULAR = path.join(ROOT, 'packages', 'angular');

const MESSAGES = {
  install:
    'This is a pnpm workspace. Use `pnpm install` / `pnpm add <pkg> --filter <package>` (not npm, yarn or bun).',
  publish:
    'Publishing is blocked for agents, and so are `npm unpublish`, `npm deprecate` and `npm dist-tag` changes. Releases go through Changesets: add a changeset with `pnpm changeset`, and CI publishes when the release PR merges (see .claude/rules/release.md).',
  tags: 'Pushing tags is blocked for agents. Release tags come from the Changesets release (see .claude/rules/release.md).',
  vitest:
    'Direct `vitest` is blocked for the Angular workspace. Use `pnpm ng test stack-weaver-angular --watch=false --include <spec>` (or `site-demo`) from packages/angular (see CLAUDE.md, Commands).',
};

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const NPM_INSTALL = new Set([
  'install',
  'i',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
  'isnt',
  'isnta',
  'isntal',
  'isntall',
  'add',
  'ci',
  'clean-install',
  'ic',
  'install-clean',
  'isntall-clean',
  'cit',
  'it',
  'install-test',
  'install-ci-test',
  'clean-install-test',
  'uninstall',
  'unlink',
  'un',
  'remove',
  'rm',
  'r',
  'update',
  'up',
  'upgrade',
  'udpate',
  'dedupe',
  'ddp',
  'link',
  'ln',
  'prune',
]);

/** Wrappers that run the rest of the command, with their options that take a value. */
const WRAPPERS = new Map([
  ['sudo', ['-u', '-g', '-C', '-D', '-h', '-p', '-U']],
  ['timeout', ['-s', '-k', '--signal', '--kill-after']],
  ['nice', ['-n']],
  ['watch', ['-n', '-d']],
  ['env', ['-u', '-C', '-S']],
  ['xargs', ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a']],
  ['exec', ['-a']],
  ...['command', 'builtin', 'nohup', 'time', 'corepack'].map(name => [name, []]),
  ...['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!'].map(name => [name, []]),
]);

/** Options that take a separate value, per command. */
const VALUE_FLAGS = new Map([
  [
    'npm',
    [
      '-w',
      '--workspace',
      '--prefix',
      '--loglevel',
      '--registry',
      '--cache',
      '--userconfig',
      '--tag',
      '--otp',
    ],
  ],
  [
    'pnpm',
    [
      '-F',
      '--filter',
      '--filter-prod',
      '-C',
      '--dir',
      '--loglevel',
      '--registry',
      '--reporter',
      '--test-pattern',
    ],
  ],
  ['npx', ['-p', '--package', '-c', '--call']],
  ['git', ['-c', '-C', '--git-dir', '--work-tree', '--namespace']],
  [
    'vitest',
    [
      '--root',
      '-r',
      '--dir',
      '--config',
      '-c',
      '--project',
      '-t',
      '--testNamePattern',
      '--reporter',
      '--environment',
      '--outputFile',
      '--shard',
    ],
  ],
]);

// MARK: - Lexing

const HEREDOC = /(?<!<)<<(?!<)-?\s*(['"]?)([\w.-]+)\1/g;
const READS_SCRIPT = /(?:^|[|;&(]\s*|\s)(?:\S*\/)?(?:ba|z|da|k)?sh(?:\s|$)/;

/**
 * Drops heredoc bodies with a linear line scan, so prose in them never counts. A body that a
 * shell reads (`bash <<EOF`, `cat <<EOF | bash`) is returned to be checked as commands.
 */
const extractHeredocs = command => {
  const lines = command.split('\n');
  // Where each trimmed line occurs, with a forward-only cursor per delimiter (`index` never
  // decreases), so finding delimiter lines stays linear even when many heredocs share one.
  const positions = new Map();
  lines.forEach((line, index) => {
    const key = line.trim();
    if (!positions.has(key)) positions.set(key, []);
    positions.get(key).push(index);
  });
  const cursors = new Map();
  const nextLine = (delimiter, after) => {
    const found = positions.get(delimiter) ?? [];
    let cursor = cursors.get(delimiter) ?? 0;
    while (cursor < found.length && found[cursor] <= after) cursor++;
    cursors.set(delimiter, cursor);
    return found[cursor];
  };
  const kept = [];
  const scripts = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    kept.push(line);
    // Tested once per line, not per heredoc: one long line can open thousands of them.
    let readsScript;
    for (const [, , delimiter] of line.matchAll(HEREDOC)) {
      // A `<<` with no delimiter line below it (`"a<<b"`, `$((1<<2))`) starts no heredoc, so
      // the lines after it still run and must still be checked.
      const end = nextLine(delimiter, index);
      if (end === undefined) continue;
      readsScript ??= READS_SCRIPT.test(line);
      if (readsScript) scripts.push(lines.slice(index + 1, end).join('\n'));
      index = end;
    }
  }
  return { text: kept.join('\n'), scripts };
};

/**
 * Splits a command line into simple commands (arrays of words) the way a shell does: quotes
 * and escapes build words, `\`+newline continues the line, `;` `&` `|` `(` `)` newlines,
 * backticks, `$(` and standalone `{` `}` end a command, and redirects drop their target.
 * `$(…)` and backticks inside double quotes are pushed to `nested`.
 */
const lex = (text, nested) => {
  const commands = [[]];
  let word = null;
  let dropTarget = false;
  const current = () => commands[commands.length - 1];
  const endCommand = () => {
    if (current().length > 0) commands.push([]);
  };
  const endWord = () => {
    if (word === null) return;
    if (dropTarget) {
      dropTarget = false;
    } else if (word === '{' || word === '}') {
      endCommand();
    } else {
      current().push(word);
    }
    word = null;
  };
  const append = value => {
    word = (word ?? '') + value;
  };

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      if (text[index + 1] === '\n') {
        index++;
      } else if (index + 1 < text.length) {
        append(text[++index]);
      }
    } else if (char === "'") {
      const end = text.indexOf("'", index + 1);
      const stop = end === -1 ? text.length : end;
      append(text.slice(index + 1, stop));
      index = stop;
    } else if (char === '"') {
      let value = '';
      let at = index + 1;
      while (at < text.length && text[at] !== '"') {
        if (text[at] === '\\' && at + 1 < text.length) {
          value += text[at + 1];
          at += 2;
        } else if (text[at] === '$' && text[at + 1] === '(') {
          let depth = 1;
          let end = at + 2;
          for (; end < text.length && depth > 0; end++) {
            if (text[end] === '(') depth++;
            else if (text[end] === ')') depth--;
          }
          nested.push(text.slice(at + 2, end - 1));
          at = end;
        } else if (text[at] === '`') {
          const close = text.indexOf('`', at + 1);
          const stop = close === -1 ? text.length : close;
          nested.push(text.slice(at + 1, stop));
          at = stop + 1;
        } else {
          value += text[at++];
        }
      }
      append(value);
      index = at;
    } else if (char === ' ' || char === '\t' || char === '\r') {
      endWord();
    } else if ('\n;&|()`'.includes(char) || (char === '$' && text[index + 1] === '(')) {
      endWord();
      endCommand();
      if (char === '$') index++;
    } else if (char === '<' || char === '>') {
      // A redirect: drop the fd number written before it (`2>`) and its target word.
      if (word !== null && /^\d+$/.test(word)) word = null;
      endWord();
      while (index + 1 < text.length && '<>&-'.includes(text[index + 1])) index++;
      dropTarget = true;
    } else {
      append(char);
    }
  }
  endWord();
  return commands.filter(words => words.length > 0);
};

// MARK: - Classification

const basename = word => word.split('/').pop();

/** Strips env assignments and wrappers (`sudo -u x`, `timeout 60`, `nice -n 5`, `env -i`). */
const stripWrappers = words => {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (/^[A-Za-z_]\w*=/.test(word)) {
      index++;
      continue;
    }
    // `command -v yarn` only looks the tool up.
    if (word === 'command' && /^-[vV]$/.test(words[index + 1] ?? '')) return [];
    // Wrappers run the same by path (`/usr/bin/env`, `/usr/bin/sudo`).
    const name = basename(word);
    const valueFlags = WRAPPERS.get(name);
    if (!valueFlags) break;
    index++;
    while (index < words.length && words[index].startsWith('-')) {
      index += valueFlags.includes(words[index]) ? 2 : 1;
    }
    if (name === 'timeout' && /^\d/.test(words[index] ?? '')) index++;
  }
  return words.slice(index);
};

/** Positional words (with their index), option values and flags of one command's arguments. */
const parseArgs = (words, kind) => {
  const valueFlags = VALUE_FLAGS.get(kind) ?? [];
  const positional = [];
  const values = new Map();
  const flags = new Set();
  const record = (flag, value) => {
    flags.add(flag);
    values.set(flag, [...(values.get(flag) ?? []), value]);
  };
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    const inline = /^(--?[\w-]+)=([\s\S]*)$/.exec(word);
    if (inline) {
      record(inline[1], inline[2]);
    } else if (valueFlags.includes(word)) {
      record(word, words[++index] ?? '');
    } else if (word.startsWith('-') && word !== '-') {
      flags.add(word);
    } else {
      positional.push({ word, index });
    }
  }
  const valuesOf = (...names) => names.flatMap(name => values.get(name) ?? []);
  return { positional, flags, valuesOf };
};

const isInAngularWorkspace = dir => {
  const relative = path.relative(ANGULAR, dir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const isVitest = word => /^vitest(?:@\S*)?$/.test(basename(word));
const isChangeset = word =>
  /^(?:changeset|@changesets\/cli)(?:@\S*)?$/.test(word) || basename(word) === 'changeset';

const SEMVER_TAG = /^(?:v?\d+\.\d+\.\d+(?:[-+][\w.]+)?|.*@\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/;

const classifyGit = args => {
  const { positional, flags, valuesOf } = parseArgs(args, 'git');
  if (positional[0]?.word !== 'push') return null;
  if (['--tags', '--follow-tags', '--mirror'].some(flag => flags.has(flag))) return 'tags';
  if (valuesOf('-c').some(value => /^push\.followtags=(?:true|yes|on|1)$/i.test(value))) {
    return 'tags';
  }
  // positional[1] is the remote; the rest are refspecs (`src:dst`, `+force`, `:delete`).
  const refs = positional.slice(2).flatMap(({ word }) => word.replace(/^\+/, '').split(':'));
  return refs.some(ref => ref.startsWith('refs/tags/') || SEMVER_TAG.test(ref)) ? 'tags' : null;
};

const classifyChangeset = args => {
  const subcommand = parseArgs(args, 'changeset').positional[0]?.word;
  if (subcommand === 'publish') return 'publish';
  // `changeset tag` (CLI v2) is `changeset git-tag` in v3: both create the release tags.
  return subcommand === 'tag' || subcommand === 'git-tag' ? 'tags' : null;
};

/** Whether a vitest run, in this context, would pick up the Angular specs. */
const vitestTargetsAngular = (args, context) => {
  const { positional, valuesOf } = parseArgs(args, 'vitest');
  const inAngular = target => isInAngularWorkspace(path.resolve(context.dir, target));
  let scoped;
  if (context.filters.length > 0) {
    scoped = context.filters.some(
      filter =>
        filter.includes('angular') ||
        /[*{]|^\.\.\.|\.\.\.$/.test(filter) ||
        (filter.startsWith('.') && inAngular(filter))
    );
  } else if (context.dirs.length > 0) {
    scoped = context.dirs.some(isInAngularWorkspace);
  } else {
    scoped = context.recursive || isInAngularWorkspace(context.dir);
  }
  return (
    scoped ||
    valuesOf('--root', '-r', '--dir').some(inAngular) ||
    positional.some(({ word }) => word.includes('/') && inAngular(word))
  );
};

/** npm commands that publish, change published versions, or run another command. */
const NPM_GUARDED = ['publish', 'unpublish', 'deprecate', 'undeprecate', 'exec', 'run-script'];

/**
 * The npm command `word` runs. npm accepts aliases and any unique prefix (`npm pu` publishes;
 * `lib/utils/cmd-list.js`). Over-matching an ambiguous prefix (`npm de`) only blocks a command
 * npm would reject anyway.
 */
const resolveNpmCommand = word => {
  if (word === undefined || NPM_INSTALL.has(word)) return word;
  if (word === 'dist-tags') return 'dist-tag';
  const match = word.length >= 2 ? NPM_GUARDED.find(command => command.startsWith(word)) : null;
  return match ?? word;
};

const classifyPackageManager = (manager, args, context) => {
  const { positional, flags } = parseArgs(args, manager === 'pnpm' ? 'pnpm' : 'npm');
  if (flags.has('--help') || flags.has('-h') || positional[0]?.word === 'help') return null;
  const [first, second] = positional;
  const subcommand = manager === 'npm' ? resolveNpmCommand(first?.word) : first?.word;
  // Unpublishing and (un)deprecating change what consumers get, as publishing does.
  if (['publish', 'pub', 'unpublish', 'deprecate', 'undeprecate'].includes(subcommand)) {
    return 'publish';
  }
  if (subcommand === 'dist-tag') {
    return ['add', 'rm', 'set'].includes(second?.word) ? 'publish' : null;
  }
  if (subcommand === 'release') return 'publish';
  if (['run', 'run-script'].includes(subcommand) && second?.word === 'release') return 'publish';
  if (['yarn', 'yarnpkg'].includes(manager) && !['run', 'exec', 'dlx'].includes(subcommand)) {
    return 'install';
  }
  if (manager === 'bun' && NPM_INSTALL.has(subcommand)) return 'install';
  if (
    manager === 'npm' &&
    (NPM_INSTALL.has(subcommand) || (subcommand === 'audit' && second?.word === 'fix'))
  ) {
    return 'install';
  }
  if (!first) return null;

  // Options before the subcommand scope what it runs (`pnpm -C dir`, `--filter`, `-r`).
  const scope = parseArgs(args.slice(0, first.index), 'pnpm');
  const inner = {
    ...context,
    dirs: [
      ...context.dirs,
      ...scope.valuesOf('-C', '--dir', '--prefix').map(dir => path.resolve(context.dir, dir)),
    ],
    filters: [...context.filters, ...scope.valuesOf('-F', '--filter', '--filter-prod')],
    recursive:
      context.recursive ||
      (manager === 'pnpm' && (scope.flags.has('-r') || scope.flags.has('--recursive'))),
  };
  // A script or binary run through the manager (`pnpm exec changeset publish`,
  // `npm run changeset -- publish`): judge what it runs.
  if (['run', 'run-script', 'exec', 'dlx', 'x'].includes(subcommand)) {
    return second ? classify(args.slice(second.index), inner) : null;
  }
  // `pnpm <name>` runs a script or a binary (`pnpm changeset publish`, `pnpm vitest run`).
  return manager === 'pnpm' || manager === 'bun' ? classify(args.slice(first.index), inner) : null;
};

/** Classifies one simple command. */
const classify = (input, context) => {
  const words = stripWrappers(input);
  if (words.length === 0) return null;
  const head = basename(words[0]);
  const args = words.slice(1);

  if (SHELLS.has(head)) {
    const at = args.findIndex(word => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word));
    // `bash -c -- 'script'`: `--` ends the options, the script is the next word.
    const script = args[at + 1] === '--' ? args[at + 2] : args[at + 1];
    return at !== -1 && script !== undefined ? check(script, context.dir, context.depth + 1) : null;
  }
  if (head === 'eval') return check(args.join(' '), context.dir, context.depth + 1);
  if (head === 'find') {
    const at = args.findIndex(word => ['-exec', '-execdir', '-ok', '-okdir'].includes(word));
    if (at === -1) return null;
    const rest = args.slice(at + 1);
    const end = rest.findIndex(word => word === ';' || word === '+');
    return classify(end === -1 ? rest : rest.slice(0, end), context);
  }
  if (head === 'git') return classifyGit(args);
  if (head === 'gh') return args[0] === 'release' && args[1] === 'create' ? 'tags' : null;
  if (isVitest(words[0])) return vitestTargetsAngular(args, context) ? 'vitest' : null;
  if (isChangeset(words[0])) return classifyChangeset(args);
  if (head === 'node') {
    const script = parseArgs(args, 'node').positional[0];
    return script && /@changesets\/cli\/bin\.js$/.test(script.word)
      ? classifyChangeset(args.slice(script.index + 1))
      : null;
  }
  if (['npx', 'bunx', 'pnpx'].includes(head)) {
    const { positional, valuesOf } = parseArgs(args, 'npx');
    for (const command of valuesOf('-c', '--call')) {
      const reason = check(command, context.dir, context.depth + 1);
      if (reason) return reason;
    }
    return positional[0] ? classify(args.slice(positional[0].index), context) : null;
  }
  if (['npm', 'pnpm', 'yarn', 'yarnpkg', 'bun'].includes(head)) {
    return classifyPackageManager(head, args, context);
  }
  return null;
};

/** Returns the reason to block `command` when run from `startDir`, or null. */
const check = (command, startDir, depth = 0) => {
  if (depth > 8) return null;
  const { text, scripts } = extractHeredocs(command);
  const nested = [];
  const commands = lex(text, nested);
  for (const inner of [...scripts, ...nested]) {
    const reason = check(inner, startDir, depth + 1);
    if (reason) return reason;
  }
  // Follow `cd` / `pushd` so `cd packages/angular && pnpm vitest` is judged in that directory.
  let dir = startDir;
  for (const words of commands) {
    if (words[0] === 'cd' || words[0] === 'pushd') {
      if (words[1] && words[1] !== '-') {
        dir = path.resolve(dir, words[1].replace(/^~(?=\/|$)/, process.env.HOME ?? '~'));
      }
      continue;
    }
    const reason = classify(words, { dir, dirs: [], filters: [], recursive: false, depth });
    if (reason) return reason;
  }
  return null;
};

const block = message => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
};

let raw = '';
process.stdin.on('data', chunk => {
  raw += chunk;
});
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    block(`block-raw-tooling: unreadable hook payload (${error.message}); blocking to be safe.`);
    return;
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') {
    block(
      'block-raw-tooling: the payload has no tool_input.command; the hook schema may have changed.'
    );
    return;
  }
  const reason = check(command, typeof payload.cwd === 'string' ? payload.cwd : process.cwd());
  if (reason) block(MESSAGES[reason]);
});
