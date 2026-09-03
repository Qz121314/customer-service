# Test Contract

This directory follows the repository-level rule: test business behavior first, and use source-level assertions only for explicit protocol, performance, safety, migration, or architecture guardrails.

## Preferred order

1. Verify observable API/UI behavior and response shape.
2. Verify D1 state changes, idempotency, quota/accounting, routing outcomes, and concurrency invariants.
3. Verify browser behavior with Chromium smoke tests when interaction or viewport geometry matters.
4. Use source-level assertions only when the implementation boundary itself is the contract, such as request-count budgets, bundle boundaries, required indexes, prohibited legacy paths, or a single shared loader.

## Source-level guardrails

A source-level guardrail must state the cost/architecture invariant it protects. It may depend on a stable public route path, migration/schema object, exported module boundary, or explicitly documented architecture boundary.

It must not depend on incidental placement or formatting, including:

- a function being located in one specific file unless that file boundary is itself the architecture contract;
- a specific neighboring function or route used only as a slice end marker;
- route ordering inside a source file;
- local variable names that are not protocol/schema fields;
- React component layout or helper placement when browser behavior can be tested instead;
- an exact SQL string when equivalent SQL preserves the same schema/cost contract.

When production code is extracted or moved without changing behavior, update stale source guardrails rather than moving production code back to satisfy them.

## CI failure triage

When a refactor causes a source-level test to fail:

1. Confirm whether the protected observable behavior or cost invariant actually regressed.
2. If behavior regressed, fix production code and keep the test strict.
3. If only source placement changed, retarget or replace the stale structural assertion.
4. Do not delete valid behavior, concurrency, migration, security, or cost tests merely to make CI green.

`helpers/source-contract.mjs` exists for the narrow case where a cost/architecture assertion must inspect one stable API route without binding the test to the identity or position of a neighboring route.
