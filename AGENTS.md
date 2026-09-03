# Repository Engineering Contract

This repository uses a contract-first development method. Tests, README decisions, performance baselines, migrations, and runtime code stay in their existing locations; do not copy their full contents into this file. This file defines **how every new development session must enter the repository, which contracts must be read before editing, and which verification gates must run before push/merge**.

## New session entrypoint

`AGENTS.md` is the first repository file to read whenever a new ChatGPT/Codex/agent session, new branch, resumed PR, or handoff starts work on `customer-service`.

Do not assume a previous chat, memory summary, PR description, or historical CI result is current. Reconstruct the repository contract from the checked-out revision before editing.

If the task arrives with only a repository URL, PR URL, error log, screenshot, or a short instruction such as “continue”, the first action is still the repository preflight below.

## Mandatory repository preflight

Before reading deeply into a target implementation or changing any file, perform this sequence against the current revision:

1. Confirm the repository, default branch, current branch/PR, and exact HEAD SHA.
2. Read `AGENTS.md`.
3. Read the relevant product contract in `README.md`.
4. For performance, hot-path, rendering, D1 cost, routing, realtime, or optimization work, read both `PERFORMANCE_BASELINE.md` and `PERFORMANCE_OPTIMIZATION_PLAN.md` before changing production code.
5. Read `package.json`. Treat its `packageManager`, `engines`, and scripts as the executable command contract; do not rely on remembered versions or commands.
6. Read the current formatting/static-analysis configuration before writing code:
   - `.editorconfig`;
   - `.prettierignore` and any Prettier config that exists;
   - `eslint.config.mjs`;
   - relevant `tsconfig*.json` files.
7. Read `.github/workflows/ci.yml` and `.githooks/pre-commit` / `.githooks/pre-push` so the local verification order is known before the first commit.
8. Read the current implementation that owns the requested behavior.
9. Read the existing tests that cover the same behavior **before writing code**. Search `test/` by feature, API, component, routing rule, quota rule, migration, or cost contract.
10. Read nearby migrations, schema/index/trigger contracts, and performance/cost tests when the change touches D1, Worker hot paths, routing, conversation creation, message delivery, retention, or realtime.
11. Classify the change as **S / M / L** by impact and risk, not by file count.
12. Identify the smallest implementation surface and expected executable behavior before editing.

Required entry order:

```text
confirm repo / branch / HEAD
→ AGENTS.md
→ README contract
→ performance baseline / plan when relevant
→ package scripts / formatter / lint / tsconfig
→ CI + git hooks
→ owning implementation
→ affected tests / migrations / cost contracts
→ classify risk
→ define expected contract
→ edit
```

Do **not** use this workflow, including at the start of a new session:

```text
open target source file
→ implement from memory
→ push
→ let GitHub Actions reveal formatting, lint, stale tests, or repository rules
```

GitHub Actions is the final independent validation gate. It must not be the first formatter, linter, typechecker, or test discovery mechanism.

## Mandatory sequence before editing

For every code change after repository preflight:

1. Identify the owning layer and the smallest implementation surface that should change.
2. Read the existing tests that cover the same behavior **before writing code**.
3. Read the matching README section and nearby migrations/contracts for already-decided product and architecture rules.
4. Identify the impact surface before implementation: UI behavior, API contract, routing, D1 schema/query shape, Worker request count, quota accounting, build, browser smoke, and deployment.
5. Write down the expected behavior in terms of the existing executable contract. If the product rule intentionally changes, update the affected test expectation in the same change instead of discovering the mismatch after CI fails.
6. Implement the root-cause fix only after the contract is clear.
7. Format changed files with the repository-installed Prettier version **before the first push**.
8. Run the verification gate required by the change level before push/merge.

Required implementation order:

```text
locate owning implementation
→ read affected tests
→ read README / migration / cost constraints
→ define expected contract
→ implement root-cause fix
→ format changed files
→ lint / typecheck / targeted tests
→ full required gate
→ push / PR / CI
```

The goal is not to make tests lead product decisions. Product decisions come first; existing tests expose the current contract so an intentional change can update implementation and contract together.

## Formatting and static analysis are input constraints

Formatting is not a cleanup step after implementation. It is part of the repository contract that must be known before code is written.

Before editing, read the current formatter and lint configuration. Before the first push, format changed files using the repository-installed tooling, for example:

```bash
pnpm exec prettier --write <changed-files>
```

Then verify the repository-wide format check:

```bash
pnpm format
```

Important distinctions:

- `pnpm format` is a **check** (`prettier --check .`), not a formatter.
- `pnpm format:write` formats the repository; for a small change, prefer formatting only changed files first.
- Do not hand-guess long-line wrapping, nested calls, regular expressions, arrays, or trailing-comma layout when Prettier can decide it deterministically.
- Follow `.editorconfig` for line endings, indentation, final newline, and trailing whitespace.
- Read `.prettierignore` before assuming every file is formatter-owned.
- Read `eslint.config.mjs` before adding helpers, imports, generated variables, React exports, Node globals, or test utilities.
- Do not call a change “ready” if formatting/lint has only been checked by remote CI.

A remote `Format` failure means the local completion gate was skipped or the write path did not reproduce repository formatting. Fix only formatting when semantics are already correct; do not mix a formatting repair with assertion or production behavior changes.

## Local hooks and CI order

The repository already defines local gates:

```text
pre-commit → pnpm preflight
pre-push   → pnpm verify
```

`pnpm preflight` covers:

```text
guardrails
→ format
→ lint
→ typecheck
```

`pnpm verify` extends that with:

```text
local D1 migrations
→ tests
→ build
→ Worker dry-run
```

The current GitHub Actions validation order is authoritative for remote CI and must be inspected before pipeline changes:

```text
Repository guardrails
→ Format
→ Validate local D1 migrations
→ Lint
→ Typecheck
→ Test
→ Build
→ Validate Worker bundle
→ Agent Chromium smoke
→ Admin Chromium smoke
```

On `main`, successful validation is followed by Cloudflare deployment, production protocol smoke, and the authenticated production performance audit when its credentials are configured.

Do not push merely to learn whether Prettier, ESLint, or TypeScript accepts the change.

## How to find the contract before coding

Use the existing repository structure instead of duplicating rules:

- Admin UI work: inspect the relevant `src/admin/` implementation and matching `test/admin-*.test.mjs` contracts.
- Agent workspace/profile work: inspect the relevant agent UI/runtime and matching `test/agent-*.test.mjs` contracts, including browser smoke when user interaction is affected.
- Routing / assignment / no-agent work: inspect the Worker routing implementation plus routing, handoff, load, quota, lifecycle, and no-agent tests before changing SQL or assignment semantics.
- Quota / billing work: inspect quota ledger tests, daily quota tests, migration history, and all D1 writes that consume or restore quota.
- Conversation lifecycle work: inspect retention/lifecycle tests, API reuse logic, routing behavior, and cleanup triggers together.
- D1 or migration work: read the current schema and relevant previous migrations first. Prefer additive/compatible changes and preserve recovery semantics.
- Cloudflare/Worker work: inspect request-count/cost tests and avoid introducing an extra Worker/D1 read when existing data can be returned in the same query/request or computed locally.
- CI/deployment work: inspect `.github/workflows/ci.yml`, package scripts, local migration checks, Worker dry-run, browser smoke, and production smoke before editing the pipeline.
- Performance work: read `PERFORMANCE_BASELINE.md` and `PERFORMANCE_OPTIMIZATION_PLAN.md` first, then locate the corresponding cost/optimization tests before touching production code.

When a test name is unclear, search `test/` for the component name, API route, SQL table/column, or behavior phrase before touching implementation.

## Test contract and source-structure rules

Tests protect behavior, security, concurrency, data integrity, explicit performance budgets, and deliberate architecture boundaries. They must not accidentally freeze incidental source layout.

Preserve and strengthen when relevant:

- API input/output and error semantics;
- D1 changes, indexes, triggers, migrations, atomicity, and concurrency;
- routing final assignment results;
- conversation lifecycle and idempotency;
- quota/daily-limit accounting;
- realtime recovery and message delivery;
- browser interaction and smoke coverage;
- explicit request-count/D1-cost/performance budgets;
- intentional runtime/security/architecture boundaries.

Avoid or refactor tests that only depend on incidental implementation details such as:

- a function living in one exact file when file placement is not the contract;
- a named function immediately following another named function;
- fixed declaration order;
- arbitrary variable/component names;
- source-string formatting that Prettier may legitimately change;
- README wording when behavior is the actual contract.

Source-level architecture/cost tests are allowed when the boundary itself is an intentional performance, security, protocol, migration, or architecture contract and runtime verification would be disproportionately expensive.

Never delete a valid behavior, concurrency, migration, security, or cost guard merely to make CI green.

## Known recurring failure patterns

These are repository-specific failure classes that have already caused wasted CI cycles or false confidence. Check them proactively.

### 1. Prettier discovered only after push

Failure pattern:

```text
logic edit
→ commit / push
→ CI Format fails
→ formatting-only follow-up commit
```

Prevention: read formatting config during repository preflight and run Prettier on changed files before the first commit/push.

### 2. ESLint discovered after Format repair

A formatting repair can expose the next static-analysis failure only on the second CI run if lint was not run locally. After formatting succeeds, run lint and typecheck before pushing again; do not serially discover cheap gates through CI.

### 3. Brittle source slicing can produce false-green tests

Tests that use `indexOf()` plus `slice()` around declarations must explicitly prove every marker exists. In JavaScript, a missing marker can produce `-1`, and `slice(start, -1)` can still return non-empty source, allowing a test to pass for the wrong reason.

Prefer stable helpers that:

- assert the target marker exists;
- scope by a deliberate route/class/top-level declaration boundary;
- do not require a specific neighboring function identity unless adjacency itself is the contract.

### 4. Stale structural tests can block correct refactors

If product behavior is unchanged but a test fails only because a helper moved files, a function was renamed, or declaration order changed, first decide whether that source boundary is a real architecture/cost contract. Preserve the invariant, not the accidental layout.

### 5. High-risk business fixes mixed with cleanup

Do not combine routing, Conversation Create, message hot-path, realtime, D1 migration/trigger changes, and broad test deletion in one PR. Separate risk classes so CI green still means something.

### 6. Duplicate compatibility paths left after a replacement

When a structural replacement is complete, remove superseded code only after migration/production compatibility is proven. Do not leave old and new implementations indefinitely, but do not delete fallbacks merely because the new path looks cleaner.

### 7. Extra D1 reads added for convenience

Before adding any read to a message, heartbeat, inbox, routing, or conversation-create path, check whether the needed fact is already present in the current query, write result, snapshot, session, or event payload. Performance work must identify the actual round trip/query eliminated or added.

### 8. Generated/runtime files mistaken for normal source

Read package scripts before editing generated files. Worker type generation is part of the typecheck path; do not hand-edit generated runtime typings as a substitute for changing the source/configuration that owns them.

### 9. GitHub Actions used as a repair bot

Keep exactly one workflow, `.github/workflows/ci.yml`. CI validates and deploys the checked-out revision; it must not generate patches, commit code, push branches, or become a substitute for local formatting/fixing.

## Change levels

### S — local / presentation-only

Examples:

- spacing, typography, borders, radius, shadows, icon sizing;
- copy or local CSS that does not alter API/data/routing/request behavior;
- documentation-only changes.

Rules:

- keep scope local;
- do not refactor unrelated logic;
- format changed files;
- run the narrowest relevant check for the affected surface.

### M — application behavior

Examples:

- Admin or Agent interaction behavior;
- form behavior and validation;
- filtering, status controls, automatic reply UI;
- changes to an existing user-visible contract without persistent-data or infrastructure changes.

Rules:

- read/update the affected behavior contract first;
- run formatting, lint, typecheck, relevant tests, and build;
- include browser smoke when the changed interaction is protected there.

### L — routing / data / infrastructure

Examples:

- D1 schema or migrations;
- routing, assignment, no-agent behavior, lifecycle, quota accounting;
- Worker/public API contracts;
- authentication/security boundaries;
- CI/deployment or request-budget changes.

Rules:

- inspect the complete cross-layer contract before coding;
- run the full repository verification gate;
- inspect browser/production smoke and recovery implications when applicable.

If a change grows beyond its original impact, reclassify it before continuing. When uncertain, use the higher level.

## Fixed engineering principles

These principles apply unless the user explicitly changes the product rule:

- The system targets individuals and small teams. Prefer simple, stable solutions over enterprise-style complexity.
- Minimize Cloudflare Workers and D1 requests. Prefer one query/request returning the data already needed, batched reads/writes, and client-side filtering/calculation where appropriate.
- Do not add a D1 read on every message, heartbeat, render, or click merely to simplify frontend code.
- Routing correctness and conversion availability are higher priority than cosmetic continuity; routing changes must be validated against assignment, no-agent, quota, and lifecycle contracts together.
- Administrator responsibilities are operational: account/password, enable state, quota/capacity, and routing scope. Agent personal presentation such as avatar/profile belongs to the agent-side profile flow unless the product rule is explicitly changed.
- Keep UI forms compact and commercially usable. Field width and grouping should reflect data semantics instead of making every control full-width by default.
- Keep shared UI primitives source-owned in `src/dashboard/ui/` using the repository shadcn/Tailwind/Radix baseline. New pages must reuse or extend those primitives instead of recreating button, input, textarea, icon, or overlay foundations.
- Keep visual tokens in `src/dashboard/ui-system.css`; feature CSS owns only page geometry or genuinely feature-specific presentation. Do not add a new late-loading polish/override file to win the cascade.
- Use `lucide-react` only through the semantic `UiIcon` boundary for functional dashboard icons. Do not add local SVG markup, character action icons, CSS data URIs, or a second icon package.
- Preserve agent desktop/mobile geometry, Visual Viewport keyboard handling, overlay stability, safe areas, and PWA behavior when migrating components. A component-library migration must not add Worker or D1 requests.
- Avoid duplicated state ownership. One rule should have one owning layer; do not patch the same behavior independently in UI, API, SQL, and CSS when a single source of truth can own it.
- Remove superseded code when a structural replacement is complete. Do not leave old and new implementations side by side without a migration reason.
- Do not hard-code mutable configuration that already belongs to admin/runtime data.
- Manual operational overrides must remain explicit and auditable; do not hide them inside automatic routing side effects.
- Keep exactly one GitHub Actions workflow: `.github/workflows/ci.yml`. Do not add one-shot, temporary, diagnostic, formatting, patching, or branch-specific workflows. Make changes on a branch, run the repository gates locally, and let the existing PR/main workflow validate and deploy them.
- GitHub Actions must remain a read-only consumer of repository contents. It may validate and deploy the checked-out revision, but it must not generate patches, commit code, or push branches.
- For performance work, do not invent a phase outside `PERFORMANCE_OPTIMIZATION_PLAN.md`; continue only from phases that actually exist in the current plan.

## Performance-work discipline

`PERFORMANCE_BASELINE.md` records the measured/recorded starting contract. `PERFORMANCE_OPTIMIZATION_PLAN.md` is the execution plan. Neither is permission to redesign business semantics.

For every performance PR:

1. Identify the current phase and risk level from the plan.
2. State which D1 read/write, Worker/DO/network round trip, React render/main-thread task, duplicate fact source, or obsolete compatibility branch is being reduced.
3. Preserve frozen routing, message, quota, lifecycle, realtime, and security behavior unless a separate product-contract change has already been made.
4. Update stale structural tests before production refactors when implementation can change without changing behavior.
5. Keep one primary risk level per PR.
6. Run the required full verification and browser smoke before merge.
7. On `main`, confirm production deployment/protocol smoke/performance audit status before declaring the phase complete.

## Root-cause-first rule

A visible symptom is not automatically the correct layer to patch. Trace it to its owning component, state flow, Worker route, SQL query/trigger, or layout contract first.

Avoid defaulting to:

- stacking CSS overrides to beat old CSS;
- adding special-case route branches instead of fixing ownership;
- adding extra D1 reads instead of extending an existing query;
- duplicating components to escape shared state problems;
- weakening/removing a test simply because current code fails it.

If a test is stale because the product rule intentionally changed, update the test and implementation together and document the new rule in the existing README section where that product behavior is described.

## Verification gates

### S

Use changed-file formatting plus the narrowest affected lint/type/test/build check. Documentation-only changes need content review and formatting only, but the PR CI still remains the final independent gate.

### M

Run the affected formatting, lint, typecheck, relevant tests, build, and browser smoke when the changed interaction is covered there.

### L

Run:

```bash
pnpm verify
```

The full local gate covers:

```text
guardrails
→ format
→ lint
→ typecheck
→ local D1 migrations
→ tests
→ build
→ Worker dry-run
```

CI remains the final merge/deployment gate and additionally runs Chromium smoke coverage.

## Repeated failure rule

When the same high-value failure class appears more than once, do not only repair the latest occurrence. Convert the reusable lesson into one of:

1. an invariant in this file;
2. an automated check in `scripts/check-repository-guardrails.mjs`;
3. an executable behavior/cost contract in `test/`;
4. a pre-commit, pre-push, or CI gate.

Do not create guardrails for every isolated cosmetic defect. Guardrails are for recurring, cross-surface, expensive, or high-risk failure classes.
