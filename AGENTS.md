# Repository Engineering Contract

This repository uses a contract-first development method. Tests, README decisions, migrations, and runtime code stay in their existing locations; do not copy them into this file. This file defines **the order in which they must be consulted before implementation starts**.

## Mandatory sequence before editing

For every code change:

1. Classify the change as **S / M / L** by impact and risk, not file count.
2. Identify the owning layer and the smallest implementation surface that should change.
3. Read the current implementation that owns the behavior.
4. Read the existing tests that cover the same behavior **before writing code**. Search `test/` by feature, API, component, routing rule, quota rule, or cost contract.
5. Read the matching README section and nearby migrations/contracts for already-decided product and architecture rules.
6. Identify the impact surface before implementation: UI behavior, API contract, routing, D1 schema/query shape, Worker request count, quota accounting, build, browser smoke, and deployment.
7. Write down the expected behavior in terms of the existing executable contract. If the product rule intentionally changes, update the affected test expectation in the same change instead of discovering the mismatch after CI fails.
8. Implement the root-cause fix only after steps 1–7 are complete.
9. Format with the repository-installed Prettier version.
10. Run the verification gate required by the change level before push/merge.

Required order:

```text
classify risk
→ locate owning implementation
→ read affected tests
→ read README / migration / cost constraints
→ define expected contract
→ implement root-cause fix
→ format
→ verify
```

Do **not** use this workflow:

```text
implement first
→ push
→ wait for CI to reveal existing requirements
→ patch tests afterwards
```

The goal is not to make tests lead product decisions. Product decisions come first; existing tests expose the current contract so an intentional change can update implementation and contract together.

## How to find the contract before coding

Use the existing repository structure instead of duplicating rules:

- Admin UI work: inspect the relevant `src/admin/` implementation and matching `test/admin-*.test.mjs` contracts.
- Agent workspace/profile work: inspect the relevant agent UI/runtime and matching `test/agent-*.test.mjs` contracts, including browser smoke when user interaction is affected.
- Routing / assignment / waiting work: inspect the Worker routing implementation plus routing, handoff, waiting, load, quota, and lifecycle tests before changing SQL or assignment semantics.
- Quota / billing work: inspect quota ledger tests, daily quota tests, migration history, and all D1 writes that consume or restore quota.
- Conversation lifecycle work: inspect retention/lifecycle tests, API reuse logic, routing behavior, and cleanup/requeue triggers together.
- D1 or migration work: read the current schema and relevant previous migrations first. Prefer additive/compatible changes and preserve recovery semantics.
- Cloudflare/Worker work: inspect request-count/cost tests and avoid introducing an extra Worker/D1 read when existing data can be returned in the same query/request or computed locally.
- CI/deployment work: inspect `.github/workflows/ci.yml`, package scripts, local migration checks, Worker dry-run, browser smoke, and production smoke before editing the pipeline.

When a test name is unclear, search `test/` for the component name, API route, SQL table/column, or behavior phrase before touching implementation.

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
- routing, assignment, waiting, lifecycle, quota accounting;
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
- Routing correctness and conversion availability are higher priority than cosmetic continuity; routing changes must be validated against assignment, waiting, quota, and lifecycle contracts together.
- Administrator responsibilities are operational: account/password, enable state, quota/capacity, and routing scope. Agent personal presentation such as avatar/profile belongs to the agent-side profile flow unless the product rule is explicitly changed.
- Keep UI forms compact and commercially usable. Field width and grouping should reflect data semantics instead of making every control full-width by default.
- Avoid duplicated state ownership. One rule should have one owning layer; do not patch the same behavior independently in UI, API, SQL, and CSS when a single source of truth can own it.
- Remove superseded code when a structural replacement is complete. Do not leave old and new implementations side by side without a migration reason.
- Do not hard-code mutable configuration that already belongs to admin/runtime data.
- Manual operational overrides must remain explicit and auditable; do not hide them inside automatic routing side effects.

## Root-cause-first rule

A visible symptom is not automatically the correct layer to patch. Trace it to its owning component, state flow, Worker route, SQL query/trigger, or layout contract first.

Avoid defaulting to:

- stacking CSS overrides to beat old CSS;
- adding special-case route branches instead of fixing ownership;
- adding extra D1 reads instead of extending an existing query;
- duplicating components to escape shared state problems;
- weakening/removing a test simply because current code fails it.

If a test is stale because the product rule intentionally changed, update the test and implementation together and document the new rule in the existing README section where that product behavior is described.

## Formatting is an input constraint

Do not guess Prettier output. Before considering a changed file complete, run the repository-installed formatter, for example:

```bash
pnpm exec prettier --write <changed-files>
```

A remote CI formatting failure means the local completion gate was skipped.

## Verification gates

### S

Use changed-file formatting plus the narrowest affected lint/type/test/build check. Documentation-only changes need content review and formatting only.

### M

Run the affected formatting, lint, typecheck, relevant tests, build, and browser smoke when the changed interaction is covered there.

### L

Run:

```bash
pnpm verify
```

The full gate covers:

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

CI remains the final merge/deployment gate.

## Repeated failure rule

When the same high-value failure class appears more than once, do not only repair the latest occurrence. Convert the reusable lesson into one of:

1. an invariant in this file;
2. an automated check in `scripts/check-repository-guardrails.mjs`;
3. an executable behavior/cost contract in `test/`;
4. a pre-commit, pre-push, or CI gate.

Do not create guardrails for every isolated cosmetic defect. Guardrails are for recurring, cross-surface, expensive, or high-risk failure classes.
