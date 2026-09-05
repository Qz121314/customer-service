import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const [
  packageText,
  engineeringContract,
  developmentStandards,
  preCommit,
  prePush,
  ciWorkflow,
  workflowFiles,
  testFiles,
  componentConfigText,
  viteConfig,
  dashboardMain,
  dashboardFiles,
  wranglerConfig,
] = await Promise.all([
  readFile('package.json', 'utf8'),
  readFile('AGENTS.md', 'utf8'),
  readFile('docs/development-standards.md', 'utf8'),
  readFile('.githooks/pre-commit', 'utf8'),
  readFile('.githooks/pre-push', 'utf8'),
  readFile('.github/workflows/ci.yml', 'utf8'),
  readdir('.github/workflows'),
  readdir('test'),
  readFile('components.json', 'utf8'),
  readFile('vite.config.ts', 'utf8'),
  readFile('src/dashboard/main.tsx', 'utf8'),
  readdir('src/dashboard'),
  readFile('wrangler.jsonc', 'utf8'),
]);

const packageJson = JSON.parse(packageText);
const scripts = packageJson.scripts ?? {};
const componentConfig = JSON.parse(componentConfigText);
const dashboardTsxFiles = dashboardFiles.filter((name) =>
  name.endsWith('.tsx'),
);
const dashboardCssFiles = dashboardFiles.filter((name) =>
  name.endsWith('.css'),
);
const [dashboardIconSource, dashboardSources, dashboardStyles] =
  await Promise.all([
    readFile('src/dashboard/icons.tsx', 'utf8'),
    Promise.all(
      dashboardTsxFiles.map(async (name) => ({
        name,
        source: await readFile(`src/dashboard/${name}`, 'utf8'),
      })),
    ),
    Promise.all(
      dashboardCssFiles.map(async (name) => ({
        name,
        source: await readFile(`src/dashboard/${name}`, 'utf8'),
      })),
    ),
  ]);

for (const scriptName of [
  'guardrails',
  'format',
  'lint',
  'typecheck',
  'db:migrate:local',
  'test',
  'build',
  'cf:check',
  'cf:provision',
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

assert.doesNotMatch(
  wranglerConfig,
  /"database_id"\s*:/u,
  'wrangler.jsonc must not commit an account-bound D1 database_id',
);
assert.match(
  scripts['db:migrate:remote'],
  /wrangler\s+d1\s+migrations\s+apply\s+DB\s+--remote/u,
  'remote D1 migrations must target the portable DB binding',
);
for (const requiredStep of [
  'pnpm cf:provision',
  'pnpm db:migrate:remote',
  'wrangler deploy',
]) {
  assert.match(
    scripts['deploy:cloudflare'],
    new RegExp(requiredStep.replaceAll(' ', '\\s+'), 'u'),
    `deploy:cloudflare must include: ${requiredStep}`,
  );
}

const deployStep =
  ciWorkflow.match(
    /- name: Deploy production to Cloudflare[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0] ?? '';
const migrationDetectionStep =
  ciWorkflow.match(
    /- name: Detect production D1 migration changes[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0] ?? '';
assert.match(
  migrationDetectionStep,
  /git diff --quiet "\$BEFORE_SHA" "\$CURRENT_SHA" -- migrations/u,
  'Routine code-only deployment must detect migration changes without querying production D1',
);
assert.match(
  deployStep,
  /if \[ "\$D1_MIGRATIONS_REQUIRED" = 'true' \]; then[\s\S]*?pnpm db:migrate:remote/u,
  'Production D1 migrations must run only when migration files changed or a manual deployment requests a conservative check',
);
assert.match(
  deployStep,
  /Skipping production D1 access: no migration files changed/u,
  'Code-only production deployments must explicitly skip production D1 access',
);
const deploymentSecretReferences = [
  ...deployStep.matchAll(/secrets\.([A-Z0-9_]+)/gu),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(deploymentSecretReferences)].toSorted(),
  ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  'Production deployment must depend on only the two Cloudflare GitHub Secrets',
);

const productionHealthStep =
  ciWorkflow.match(
    /- name: Verify production health without D1[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0] ?? '';
assert.match(
  productionHealthStep,
  /\/api\/health/u,
  'Routine post-deploy verification must use the D1-free health endpoint',
);
assert.doesNotMatch(
  productionHealthStep,
  /smoke:production|perf:audit:production/u,
  'Routine post-deploy health verification must not invoke production D1 smoke or performance audits',
);

const productionSmokeStep =
  ciWorkflow.match(
    /- name: Smoke test production protocols[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0] ?? '';
const performanceAuditStep =
  ciWorkflow.match(
    /- name: Audit authenticated production performance[\s\S]*?(?=\n\s+- name:)/u,
  )?.[0] ?? '';
const manualProductionVerificationGuard =
  /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.production_verification == true/u;
for (const [label, step] of [
  ['Production protocol smoke', productionSmokeStep],
  ['Authenticated production performance audit', performanceAuditStep],
]) {
  assert.match(
    step,
    manualProductionVerificationGuard,
    `${label} must require explicit workflow_dispatch production verification`,
  );
}
assert.match(
  performanceAuditStep,
  /PERF_AUDIT_RUNS:\s*\$\{\{\s*inputs\.performance_runs\s*\|\|\s*'1'\s*\}\}/u,
  'Manual production performance audit must default to one cold-cache run',
);

const performanceAuditSecretReferences = [
  ...performanceAuditStep.matchAll(/secrets\.([A-Z0-9_]+)/gu),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(performanceAuditSecretReferences)].toSorted(),
  [
    'PERF_AUDIT_ADMIN_PASSWORD',
    'PERF_AUDIT_AGENT_PASSWORD',
    'PERF_AUDIT_AGENT_USERNAME',
  ],
  'Production performance audit must use only its dedicated GitHub Secrets',
);

const allowedCiSecrets = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN',
  'PERF_AUDIT_ADMIN_PASSWORD',
  'PERF_AUDIT_AGENT_PASSWORD',
  'PERF_AUDIT_AGENT_USERNAME',
];
const ciSecretReferences = [
  ...ciWorkflow.matchAll(/secrets\.([A-Z0-9_]+)/gu),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(ciSecretReferences)].toSorted(),
  allowedCiSecrets.toSorted(),
  'CI may use only Cloudflare deployment secrets and dedicated performance-audit credentials',
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
  /Routine pull requests and main pushes must not use production D1 for smoke, performance, bootstrap, or data validation/u,
  'engineering contract must prohibit routine CI from consuming production D1 verification quota',
);
assert.match(
  engineeringContract,
  /Keep exactly one GitHub Actions workflow/u,
  'engineering contract must prohibit temporary and one-shot workflows',
);
assert.match(
  developmentStandards,
  /测试默认验证可观察行为/u,
  'development standards must keep behavior-first testing as the default',
);
assert.match(
  developmentStandards,
  /业务、API 和 UI 契约测试禁止把 `src\//u,
  'development standards must reject source-string business contracts',
);

for (const dependency of [
  '@radix-ui/react-slot',
  'class-variance-authority',
  'clsx',
  'lucide-react',
  'tailwind-merge',
]) {
  assert.equal(
    typeof packageJson.dependencies?.[dependency],
    'string',
    `UI design-system dependency is missing: ${dependency}`,
  );
}

for (const dependency of ['@tailwindcss/vite', 'tailwindcss']) {
  assert.equal(
    typeof packageJson.devDependencies?.[dependency],
    'string',
    `UI build dependency is missing: ${dependency}`,
  );
}

assert.equal(componentConfig.style, 'new-york');
assert.equal(componentConfig.iconLibrary, 'lucide');
assert.equal(componentConfig.tailwind?.cssVariables, true);
assert.match(viteConfig, /tailwindcss from '@tailwindcss\/vite'/u);
assert.match(dashboardMain, /import '\.\/ui-system\.css'/u);

assert.ok(
  dashboardCssFiles.length <= 23,
  `Dashboard CSS ownership regressed to ${dashboardCssFiles.length} files`,
);

assert.match(dashboardIconSource, /export type UiIconName/u);
assert.match(dashboardIconSource, /from 'lucide-react'/u);
assert.match(dashboardIconSource, /Record<UiIconName, LucideIcon>/u);
assert.match(dashboardIconSource, /settings: Settings/u);
assert.match(dashboardIconSource, /strokeWidth=\{1\.9\}/u);
assert.match(dashboardIconSource, /aria-hidden="true"/u);
assert.match(dashboardIconSource, /focusable="false"/u);
assert.doesNotMatch(dashboardIconSource, /<svg\b|<path\b|<circle\b/u);

const functionalIconCharacters = />\s*[×＋✓‹]\s*</u;
for (const { name, source } of dashboardSources) {
  if (name !== 'icons.tsx') {
    assert.doesNotMatch(source, /<svg\b/u, `${name} contains a local SVG`);
  }
  assert.doesNotMatch(
    source,
    functionalIconCharacters,
    `${name} contains a character action icon`,
  );
}
for (const { name, source } of dashboardStyles) {
  assert.doesNotMatch(
    source,
    /data:image\/svg\+xml|content:\s*['"][↗➤‹＋✓×]['"]/u,
    `${name} contains an embedded or character action icon`,
  );
}

const executableTests = testFiles.filter((name) => name.endsWith('.test.mjs'));
assert.ok(
  executableTests.length > 0,
  'repository must keep executable tests in test/',
);

const namedContractTests = executableTests.filter((name) =>
  name.endsWith('-contract.test.mjs'),
);
for (const name of namedContractTests) {
  const source = await readFile(`test/${name}`, 'utf8');
  assert.doesNotMatch(
    source,
    /from ['"]node:fs(?:\/promises)?['"]/u,
    `${name} must execute observable behavior instead of reading source files as text`,
  );
}

const guardrailsIndex = ciWorkflow.indexOf('pnpm guardrails');
const formatIndex = ciWorkflow.indexOf('pnpm format');
const migrationIndex = ciWorkflow.indexOf('pnpm db:migrate:local');
assert.notEqual(guardrailsIndex, -1, 'CI must run pnpm guardrails');
assert.notEqual(formatIndex, -1, 'CI must run pnpm format');
assert.notEqual(migrationIndex, -1, 'CI must validate local D1 migrations');
assert.ok(
  guardrailsIndex < formatIndex && formatIndex < migrationIndex,
  'CI must validate guardrails and formatting before D1 migrations and implementation checks',
);

console.log(
  `Repository guardrails passed (${executableTests.length} executable tests discovered).`,
);
