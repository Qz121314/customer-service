import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const [
  packageText,
  engineeringContract,
  preCommit,
  prePush,
  ciWorkflow,
  workflowFiles,
  testFiles,
] = await Promise.all([
  readFile('package.json', 'utf8'),
  readFile('AGENTS.md', 'utf8'),
  readFile('.githooks/pre-commit', 'utf8'),
  readFile('.githooks/pre-push', 'utf8'),
  readFile('.github/workflows/ci.yml', 'utf8'),
  readdir('.github/workflows'),
  readdir('test'),
]);

const packageJson = JSON.parse(packageText);
const scripts = packageJson.scripts ?? {};

for (const scriptName of [
  'guardrails',
  'format',
  'lint',
  'typecheck',
  'db:migrate:local',
  'test',
  'build',
  'cf:check',
  'preflight',
  'verify',
]) {
  assert.equal(
    typeof scripts[scriptName],
    'string',
    `Required package script is missing: ${scriptName}`,
  );
}

for (const requiredStep of [
  'pnpm guardrails',
  'pnpm format',
  'pnpm lint',
  'pnpm typecheck',
]) {
  assert.match(
    scripts.preflight,
    new RegExp(requiredStep.replaceAll(' ', '\\s+'), 'u'),
    `preflight must include: ${requiredStep}`,
  );
}

for (const requiredStep of [
  'pnpm preflight',
  'pnpm db:migrate:local',
  'pnpm test',
  'pnpm build',
  'pnpm cf:check',
]) {
  assert.match(
    scripts.verify,
    new RegExp(requiredStep.replaceAll(' ', '\\s+'), 'u'),
    `verify must include: ${requiredStep}`,
  );
}

assert.match(
  preCommit,
  /pnpm\s+preflight/u,
  'pre-commit must run pnpm preflight',
);
assert.match(prePush, /pnpm\s+verify/u, 'pre-push must run pnpm verify');

assert.deepEqual(
  workflowFiles.toSorted(),
  ['ci.yml'],
  'Repository must keep exactly one GitHub Actions workflow: .github/workflows/ci.yml',
);
assert.match(
  ciWorkflow,
  /^name:\s*CI and Deploy\s*$/mu,
  'The single workflow must keep the stable CI and Deploy name',
);
assert.match(
  ciWorkflow,
  /permissions:\s*\n\s+contents:\s*read\s*$/mu,
  'CI must keep repository contents read-only',
);
assert.doesNotMatch(
  ciWorkflow,
  /\b(?:git\s+push|gh\s+pr|contents:\s*write)\b/u,
  'CI must validate and deploy only; it must never patch or push repository code',
);

assert.match(
  engineeringContract,
  /Read the existing tests that cover the same behavior \*\*before writing code\*\*/u,
  'engineering contract must require reading affected tests before implementation',
);
assert.match(
  engineeringContract,
  /Read the matching README section and nearby migrations\/contracts/u,
  'engineering contract must require reading existing product/data decisions before implementation',
);
assert.match(
  engineeringContract,
  /Do \*\*not\*\* use this workflow/u,
  'engineering contract must explicitly reject implement-first development',
);
assert.match(
  engineeringContract,
  /Minimize Cloudflare Workers and D1 requests/u,
  'engineering contract must preserve the Worker/D1 request-budget principle',
);
assert.match(
  engineeringContract,
  /Keep exactly one GitHub Actions workflow/u,
  'engineering contract must prohibit temporary and one-shot workflows',
);

const executableContracts = testFiles.filter((name) =>
  name.endsWith('.test.mjs'),
);
assert.ok(
  executableContracts.length > 0,
  'repository must keep executable contracts in test/',
);

const guardrailsIndex = ciWorkflow.indexOf('pnpm guardrails');
const migrationIndex = ciWorkflow.indexOf('pnpm db:migrate:local');
assert.notEqual(guardrailsIndex, -1, 'CI must run pnpm guardrails');
assert.notEqual(migrationIndex, -1, 'CI must validate local D1 migrations');
assert.ok(
  guardrailsIndex < migrationIndex,
  'CI must validate repository guardrails before D1 migrations and implementation checks',
);

console.log(
  `Repository guardrails passed (${executableContracts.length} executable test contracts discovered).`,
);
