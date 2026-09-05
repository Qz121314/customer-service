import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';

const allowedEnvFiles = new Set(['.env.example']);
const riskyFileNames = [/^\.env(?:\..+)?$/u, /\.pem$/u, /\.key$/u, /id_(?:rsa|dsa|ecdsa|ed25519)$/u];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-[A-Za-z0-9]{20,}\b/u,
];
const debugPatterns = [/\bdebugger\s*;/u, /\bconsole\.log\s*\(/u];

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function splitLines(value) {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function changedFiles() {
  const base = process.env.PREDEPLOY_BASE_SHA?.trim();
  const head = process.env.PREDEPLOY_HEAD_SHA?.trim() || 'HEAD';
  const files = new Set();

  if (base && !/^0+$/.test(base)) {
    for (const file of splitLines(git(['diff', '--name-only', '--diff-filter=ACMR', base, head]))) {
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

const changed = changedFiles();
const problems = [];

for (const file of changed) {
  const name = basename(file);

  if (!allowedEnvFiles.has(name) && riskyFileNames.some((pattern) => pattern.test(name))) {
    problems.push(`${file}: sensitive file type must not be committed`);
    continue;
  }

  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (secretPatterns.some((pattern) => pattern.test(source))) {
    problems.push(`${file}: possible committed secret detected`);
  }

  if (!file.startsWith('test/') && !file.startsWith('scripts/') && debugPatterns.some((pattern) => pattern.test(source))) {
    problems.push(`${file}: debug statement detected`);
  }
}

if (problems.length > 0) {
  console.error('Deployment safety checks failed:');
  for (const problem of problems) {
    console.error(`- ${problem}`);
  }
  process.exit(1);
}

console.log(`Deployment safety checks passed for ${changed.length} changed file(s).`);
