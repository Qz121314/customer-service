# Client v1 conversation start

## Product contract

`POST /client/v1/conversations` means **the visitor clicked a product CTA**. The click is both the consultation start and a durable customer `product_context` message.

A storefront CTA should therefore create the conversation immediately when the user chooses to start support. The visitor does not need to type a message first.

```text
CTA click
→ POST /client/v1/conversations
→ reuse or create conversation using the existing routing decision order
→ persist the product-context snapshot as a customer message
→ attempt first agent assignment
→ first successful assignment creates one traffic receipt
→ optional assigned-agent greeting is resolved exactly once
→ notify with the product message's real message ID
→ return the conversation with the product message before any generated greeting
→ later visitor text uses /messages
```

## CTA request

The request requires the existing visitor, handoff and product context but does not require message fields:

```json
{
  "visitorId": "ABC123",
  "sourceHandoffId": "11111111-1111-4111-8111-111111111111",
  "product": {
    "id": "product-1"
  }
}
```

The product ID is resolved against the Site-synchronized product catalog. That catalog owns the canonical product fields. Customer Service stores the same product snapshot in the conversation and in the durable `product_context` message (`productId`, `title`, `coverUrl`, `href`, `sectionId`, `sectionName`, `categoryId`, `categoryName`). Historical messages render this snapshot and never reread the current catalog.

`sourceHandoffId` remains the idempotency boundary for one CTA consultation. Retrying the same handoff returns the existing conversation and must not create a second conversation, traffic receipt, quota charge or greeting.

## Optional legacy body compatibility

Existing callers may continue to provide both:

```json
{
  "clientMessageId": "visitor-message-1",
  "message": "Hello"
}
```

Existing callers may keep supplying these fields. `clientMessageId` becomes the product message's idempotency identity; otherwise the server derives one from `sourceHandoffId`. The structured product snapshot, not the body string, owns product-card rendering. New storefront integrations should use CTA creation for the product message and the normal message endpoint for later text.

## Visitor messages after start

Visitor text after the consultation exists uses:

```http
POST /client/v1/conversations/:id/messages
```

The message endpoint remains independently idempotent through `clientMessageId`.

## First reception and quota

A CTA start consumes a seat quota only when its first agent assignment succeeds.
If no eligible agent exists, the temporary creation is discarded and the API
returns `503 NO_AGENT_AVAILABLE` with the administrator-authored message.

The successful assignment is the existing billing boundary. When no eligible agent exists, the temporary conversation and its product message are deleted together; no reminder or greeting is emitted.

```text
new consultation claim
→ eligible agent selected
→ immutable agent_traffic_receipts row
→ daily reception count +1
→ paid traffic quota consumed once when enabled
```

Assigned-conversation reconnects and retries cannot create a second traffic receipt and therefore cannot consume another consultation unit. Historical or abnormal unassigned records are never recovered.

## Optional initial greeting

The assigned agent may enable a personal first greeting. It is optional and defaults off.

On the first traffic receipt, D1 resolves the `initial_greeting` automation once:

- configured and enabled: store `sent` and materialize one normal `agent` message;
- not configured or disabled: store `skipped` and create no message.

The automation receipt uses `(conversation_id, automation_key)` as its unique boundary. A later reconnect, retry or settings change cannot send another initial greeting.

Existing conversations are migrated as `skipped`, so deploying the feature never sends retroactive greetings.

## Product-message attention

Every CTA creates one real unread customer message. A new conversation emits `NEW_CONVERSATION`; a two-hour active reuse emits `CUSTOMER_REPLY`. Both reminder forms use the durable product message ID, never the conversation ID. Replaying the same handoff or product-message identity emits neither a duplicate message nor a duplicate reminder.

The first effective assignment separately owns the exactly-once greeting. The product message is persisted first, so both the agent and visitor timelines render the customer product card before the agent greeting.

The automatically generated greeting does not create an agent-side sound event because it is the agent's own outgoing message.
