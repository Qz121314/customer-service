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
const dashboardTsxFiles = dashboardFiles.filter((name) => name.endsWith('.tsx'));
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
const cloudflareSecretReferences = [
  ...ciWorkflow.matchAll(/secrets\.([A-Z0-9_]+)/gu),
].map((match) => match[1]);
assert.deepEqual(
  [...new Set(cloudflareSecretReferences)].toSorted(),
  ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN'],
  'CI deployment must depend on only the two Cloudflare GitHub Secrets',
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
  dashboardCssFiles.length <= 22,
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
