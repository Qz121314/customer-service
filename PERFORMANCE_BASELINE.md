# Customer Service Performance Baseline

> Phase 0 baseline recorded from `main` commit `7f70624e149e76f3465862935bc4e2e4978afba1` on 2026-09-01. This document records the starting point for the performance plan. It does not change production behavior or set permission to relax business, security, concurrency, migration, or browser coverage.

## 1. CI and deployment baseline

The complete `CI and Deploy` workflow passed on `main`:

- Repository guardrails: passed.
- Prettier: passed.
- Local D1 migrations: passed.
- ESLint: passed.
- UI and Worker TypeScript: passed.
- Node behavior tests: passed.
- Vite build: passed.
- Worker dry-run bundle: passed.
- Agent Chromium Smoke: passed.
- Admin Chromium Smoke: passed.
- Cloudflare production deploy: passed.
- Production protocol Smoke: passed.

The baseline workflow is GitHub Actions run `33574257888`.

The repository currently contains 53 Node test files:

- 4 browser Smoke specifications.
- 10 files explicitly named as cost or optimization contracts.
- 26 files that exercise D1 or the migration chain.
- 30 files that read production source or migration text and then match strings or regular expressions. Some of these also contain real behavior or database coverage and must not be deleted as a group.

## 2. Frozen delivery contract

Before performance production code changes, the following complete path is green in the real Hono and D1 flow:

```text
Agent preset
→ agent attachment message
→ immutable message_attachments snapshot
→ conversation room event
→ visitor-level realtime event
→ visitor media/history endpoint
→ incremental agent history
```

The test covers a WhatsApp card including label, normalized value, optional preset message, message ownership, message ID association, realtime payload, and visitor history payload. Text, image, contact card, auto greeting, idempotency, read state, routing, quota, retention, and no-agent behavior remain frozen.

## 3. Agent and Admin frontend baseline

### 3.1 Route and style loading

Agent and Admin are already separate lazy route modules. The global entry loads only `ui-system.css` before selecting the route.

The lazy route modules still serialize style loading:

- Agent waits for 11 sequential CSS dynamic imports before React mounts.
- Admin waits for 14 sequential CSS dynamic imports before React mounts.
- The serial `await import()` chain creates an avoidable request/dependency waterfall.
- The optimization must keep Agent and Admin route ownership separate and must not create a global dashboard CSS bundle.

### 3.2 Draft persistence

Agent draft state updates in memory for every input change. A React effect immediately calls `saveAgentConversationDrafts()` whenever the draft object changes.

Current cost:

- One synchronous `JSON.stringify` and `localStorage.setItem` can occur for every typed character.
- Drafts are scoped by agent and expire after 24 hours.
- Storage failure is already best-effort and does not interrupt chat.

Target contract:

- Keep immediate in-memory input.
- Debounce persistent writes for approximately 400 ms.
- Flush when switching conversation, hiding or leaving the page, and unmounting.
- Preserve the 24-hour TTL and storage-failure behavior.

### 3.3 Attachment lookup

The Thread render maps every message and filters the complete attachment array for every message.

Current complexity is `O(message count × attachment count)`.

Target contract is a memoized `Map<messageId, attachments[]>` with one grouping pass and constant-time message lookup. The grouping behavior must have a direct unit test; the test must not assert a React variable name.

### 3.4 Long conversations

The Agent conversation detail endpoint currently returns messages ordered by ascending timestamp and ID with `LIMIT 500`.

Current behavior:

- The initial request can send up to 500 messages and associated attachment rows to the browser.
- With no cursor, the query starts from the oldest rows, so a conversation exceeding 500 stored messages can omit newer history from the initial response.
- The existing cursor is an after-cursor for realtime reconnect and incremental recovery.
- There is no backward history cursor for loading older messages from a latest-message initial page.

Required design:

- Initial page returns the latest 50–100 messages, rendered in chronological order.
- A before-cursor loads older history while preserving scroll position.
- The existing after-cursor remains responsible for reconnect and new-message recovery.
- Read cursors and attachment-to-message association must remain correct.
- Virtualization is deferred until measured DOM size still requires it.

### 3.5 Render and mobile viewport

`AgentPortal` owns Inbox, Thread, Composer, overlays, realtime state, drafts, uploads, and settings in one component boundary.

Current mobile runtime installs two MutationObservers:

- The viewport geometry observer watches the full React root with `childList + subtree`.
- The history observer watches the full root for child and class changes.
- Message insertion can therefore schedule global geometry work even when viewport dimensions did not change.

The first mobile optimization must prefer `dvh`, flex layout, and safe-area CSS. Any remaining JavaScript observer must watch the smallest stable node and must be validated with keyboard, rotation, thread back navigation, contact-card sheet, and swipe actions.

## 4. Worker and D1 baseline

### 4.1 Agent bootstrap and Inbox

Bootstrap and normal Inbox refresh each authenticate the session before loading Inbox state.

The unfiltered Inbox scan already folds open, pending, and closed counts into the conversation query and loads quota overview separately. However, bootstrap and refresh maintain duplicate SQL and result mapping. Quota and Overview logic also exist in more than one runtime file.

Optimization constraint:

- Share one loader without adding another D1 query or another external request.
- Preserve the current closed preview limit, local filters, quota fields, and response shape.

### 4.2 Agent session

`agent-session.ts` provides the shared session helper, but `agent-api.ts` still contains its own cookie, token hashing, session identity, and authentication implementation.

Optimization constraint:

- Use one authentication implementation.
- Keep exactly one session lookup per request.
- Do not add edge caching until profiling demonstrates a need.

### 4.3 Agent text send

The normal write path already has several important optimizations:

- A slim ownership/status read.
- `INSERT OR IGNORE` client-message idempotency.
- No post-insert message reread on the successful path.
- A direct in-memory message response snapshot.
- Overview aggregation only when an open conversation changes to pending.

Remaining cost:

- Message insert and conversation update are separate D1 operations.
- `broadcastClientConversationEvent()` performs a full conversation/visitor/agent SELECT after persistence.
- The HTTP response waits for conversation-room and visitor/inbox delivery attempts.
- Open-to-pending delivery can add an Overview scan.

The next hot-path phase must remove the broadcast reread by accepting an explicit final snapshot. Persistence, status, unread counters, preview, timestamp, duplicate detection, and conflicts remain synchronous. Realtime and push may move behind `waitUntil` only after persistence succeeds.

### 4.4 Contact-card send

The contact-card route currently performs:

- Session authentication.
- Conversation/preset ownership load.
- Duplicate lookup.
- Message insert.
- A D1 batch for immutable attachment snapshots and conversation update.
- Realtime delivery using a generated public attachment snapshot.
- A full conversation reread inside the shared client broadcaster.

The card route is behaviorally green. It should adopt the same snapshot-driven dispatcher as text rather than receiving a separate optimization path.

### 4.5 Conversation create

The create route already combines message replay and handoff replay in one statement and reuses the assignment broadcaster snapshot on the normal successful-assignment branch.

Remaining high-risk work includes:

- Multiple `ownedConversation()` calls in replay and reuse branches.
- Runtime fallback from `conversation_source_handoffs` to legacy `conversations.source_handoff_id`.
- Re-reads after remembering a handoff or resolving reuse ownership.

This phase remains last. Routing SQL, quota and daily guards, global strict round robin, affinity order, and atomic assignment are protected from redesign.

## 5. Test classification and disposition

### Keep as behavior, security, concurrency, database, or browser coverage

Examples include:

- `customer-service-full-flow.test.mjs`
- `agent-auto-greeting.test.mjs`
- `agent-draft-behavior.test.mjs`
- `agent-daily-quota.test.mjs`
- `agent-traffic-quota.test.mjs`
- `contact-card-migration.test.mjs`
- `message-attachments.test.mjs`
- `final-business-routing-closure.test.mjs`
- `product-agent-routing.test.mjs`
- `quota-ledger-reconciliation.test.mjs`
- All four browser Smoke specifications

### Convert when the related phase changes

These tests currently depend materially on source strings or implementation layout and should be replaced or supplemented with behavior or measurable budgets before the related production refactor:

- `agent-inbox-optimization.test.mjs`
- `agent-mobile-keyboard-viewport.test.mjs`
- `agent-conversation-detail-cost.test.mjs`
- `message-send-d1-cost.test.mjs`
- `conversation-create-d1-cost.test.mjs`
- `media-hot-path-cost.test.mjs`
- `push-media-hot-path-cost.test.mjs`
- `routing-scope-d1-cost.test.mjs`
- `agent-presence-cost.test.mjs`
- `agent-reception-efficiency.test.mjs`

Replacement rules:

- D1 cost tests should instrument prepare, batch, and executed statement counts on the real handler path.
- CSS loading should be checked from Vite output or browser resource entries.
- Mobile viewport behavior belongs in Chromium geometry assertions.
- Attachment grouping and draft scheduling should be direct unit behavior tests.
- Stable protocol, schema, trigger, index, security, and forbidden-runtime boundary checks may remain structural when the structure itself is the contract.

No existing test is deleted in Phase 0.

## 6. Phase 0 exit decision

Phase 0 establishes that:

- `main` is green and deployed.
- The agent-to-visitor contact-card contract is covered.
- Current frontend and Worker hot paths have explicit before-state descriptions.
- Source-structure tests are identified before production refactoring.
- The first production phase is limited to route CSS loading.
- Draft debounce and attachment indexing follow in a separate low-risk PR.
- Mobile viewport, pagination/render boundaries, Worker loader sharing, message hot path, and conversation create remain separate later phases.
