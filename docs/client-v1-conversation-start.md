# Client v1 conversation start

## Product contract

`POST /client/v1/conversations` means **start a consultation**. It is not the visitor-message endpoint.

A storefront CTA should therefore attempt the consultation immediately when the user chooses to start support. The visitor does not need to type a message first.

```text
CTA click
→ POST /client/v1/conversations
→ create a temporary start claim
→ attempt first agent assignment
→ assigned: keep the conversation and create one traffic receipt
→ no eligible agent: roll back the failed start and return NO_AGENT_AVAILABLE
→ optional assigned-agent greeting is resolved exactly once
→ later visitor text uses /messages
```

There is no visitor waiting queue. A start that cannot be assigned does not remain as an open or pending conversation for later recovery.

## CTA request

The request requires the existing visitor, handoff and product context but does not require message fields:

```json
{
  "visitorId": "ABC123",
  "sourceHandoffId": "11111111-1111-4111-8111-111111111111",
  "product": {
    "id": "product-1",
    "sectionId": "west",
    "sectionName": "West",
    "categoryId": "category-1",
    "categoryName": "Category 1",
    "title": "Product 1",
    "href": "/sections/west/products/product-1/",
    "coverUrl": null
  }
}
```

`sourceHandoffId` remains the idempotency boundary for one successful CTA consultation. Retrying an already successful handoff returns the existing conversation and must not create a second conversation, traffic receipt, quota charge or greeting.

When no eligible agent exists, the failed start is rolled back, including its source handoff and 24-hour conversation-creation counters. A later CTA may therefore try again normally.

## No available agent

When routing cannot select an eligible agent, the API returns HTTP `503`:

```json
{
  "error": {
    "code": "NO_AGENT_AVAILABLE",
    "message": "当前暂无可接待客服，请稍后再试。"
  }
}
```

The storefront should display `error.message` directly to the visitor. Administrators can change this message from the customer-service management UI, for example to publish business hours.

The failure path guarantees:

- no waiting conversation is retained;
- no source-handoff claim is retained;
- no consultation traffic receipt is created;
- no daily reception or purchased consultation quota is consumed;
- no 24-hour visitor/source conversation-creation count is consumed;
- no agent push notification or initial greeting is sent.

The Cloudflare short-burst limiter remains an abuse-control boundary for incoming requests and is not a billable consultation counter.

## Legacy create-with-message compatibility

Existing callers may continue to provide both:

```json
{
  "clientMessageId": "visitor-message-1",
  "message": "Hello"
}
```

The two fields are an optional pair. If either field is supplied, both must be valid. New storefront integrations should prefer CTA-only creation followed by the normal message endpoint.

If a legacy create-with-message request cannot be assigned, its temporary conversation and message are removed by the same no-agent rollback and the caller receives `NO_AGENT_AVAILABLE`.

## Visitor messages after start

Visitor text after a successful consultation exists uses:

```http
POST /client/v1/conversations/:id/messages
```

The message endpoint remains independently idempotent through `clientMessageId`.

Because failed starts are removed immediately, the message endpoint is not a waiting-recovery path and does not need to revive an unassigned consultation.

## First reception and quota

The first successful agent assignment is the billing boundary:

```text
new consultation start
→ eligible agent selected
→ immutable agent_traffic_receipts row
→ daily reception count +1
→ paid traffic quota consumed once when enabled
```

Retries and reconnects cannot create a second traffic receipt and therefore cannot consume another consultation unit. A no-agent failure creates no traffic receipt and is rolled back before it becomes a consultation.

## Optional initial greeting

The assigned agent may enable a personal first greeting. It is optional and defaults off.

On the first traffic receipt, D1 resolves the `initial_greeting` automation once:

- configured and enabled: store `sent` and materialize one normal `agent` message;
- not configured or disabled: store `skipped` and create no message.

The automation receipt uses `(conversation_id, automation_key)` as its unique boundary. A reconnect or settings change cannot send another initial greeting.

Existing conversations are migrated as `skipped`, so deploying the feature never sends retroactive greetings. A rejected no-agent start never resolves this automation.

## New-consultation attention

The first effective assignment is also a seat-attention event. D1 ensures `agent_unread_count >= 1` at first reception.

This intentionally reuses the existing agent Inbox notification path:

- CTA with no visitor message: `0 → 1`, so the existing foreground tone fires once;
- legacy create with one visitor message: unread is already `1`, so it is not incremented to `2`;
- opening/reading the conversation recalculates unread state from actual visitor messages and acknowledges the consultation event.

The automatically generated greeting does not create an agent-side sound event because it is the agent's own outgoing message. No-agent starts never reach the attention path.
