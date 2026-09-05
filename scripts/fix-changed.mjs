import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const prettierExtensions = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.jsonc',
  '.css',
  '.scss',
  '.md',
  '.html',
  '.yml',
  '.yaml',
]);
const eslintExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);
const maxChangedFiles = Number(process.env.PREDEPLOY_MAX_CHANGED_FILES ?? 120);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr ?? '');
    }
    process.exit(result.status ?? 1);
  }

  return options.capture ? result.stdout.trimEnd() : '';
}

function git(args) {
  return run('git', args, { capture: true });
}

function hasCommit(ref) {
  return (
    spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], {
      stdio: 'ignore',
    }).status === 0
  );
}

function ensureCommit(ref) {
  if (!ref || ref === 'HEAD' || hasCommit(ref)) {
    return;
  }

  run('git', ['fetch', '--no-tags', '--depth=1', 'origin', ref]);
}

function splitLines(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function githubRange() {
  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath || !existsSync(eventPath)) {
    return {};
  }

  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    return {
      base: event.pull_request?.base?.sha ?? event.before,
      head: event.pull_request?.head?.sha ?? event.after ?? process.env.GITHUB_SHA,
    };
  } catch {
    return {};
  }
}

function changedFiles() {
  const github = githubRange();
  const base = process.env.PREDEPLOY_BASE_SHA?.trim() || github.base;
  const head = process.env.PREDEPLOY_HEAD_SHA?.trim() || github.head || 'HEAD';
  const files = new Set();

  if (base && !/^0+$/.test(base)) {
    ensureCommit(base);
    ensureCommit(head);
    for (const file of splitLines(
      git(['diff', '--name-only', '--diff-filter=ACMR', base, head]),
    )) {
      files.add(file);
    }
  } else {
    for (const args of [
      ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'],
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    ]) {
      for (const file of splitLines(git(args))) {
        files.add(file);
      }
    }
  }

  return [...files].filter((file) => existsSync(file));
}

function dirtyPaths() {
  return new Set(
    git(['status', '--porcelain'])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3)),
  );
}

const changed = changedFiles();
if (changed.length === 0) {
  console.log('No changed files require automatic formatting.');
  process.exit(0);
}

if (!Number.isFinite(maxChangedFiles) || maxChangedFiles < 1) {
  throw new Error('PREDEPLOY_MAX_CHANGED_FILES must be a positive number.');
}

if (changed.length > maxChangedFiles) {
  throw new Error(
    `Refusing automatic formatting for ${changed.length} changed files (limit: ${maxChangedFiles}). Set PREDEPLOY_MAX_CHANGED_FILES explicitly for an intentional large change.`,
  );
}

const allowedPaths = new Set([...dirtyPaths(), ...changed]);
const prettierFiles = changed.filter((file) => prettierExtensions.has(extname(file)));
const eslintFiles = changed.filter((file) => eslintExtensions.has(extname(file)));

if (prettierFiles.length > 0) {
  run('pnpm', ['exec', 'prettier', '--write', ...prettierFiles]);
}

if (eslintFiles.length > 0) {
  run('pnpm', ['exec', 'eslint', '--fix', ...eslintFiles]);
}

const unrelated = [...dirtyPaths()].filter((file) => !allowedPaths.has(file));
if (unrelated.length > 0) {
  throw new Error(
    `Automatic fixes modified unrelated files:\n${unrelated.map((file) => `- ${file}`).join('\n')}`,
  );
}

console.log(
  `Automatic fixes completed for ${changed.length} changed file(s): ${prettierFiles.length} Prettier candidate(s), ${eslintFiles.length} ESLint candidate(s).`,
);
