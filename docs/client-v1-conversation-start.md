# Client v1 conversation start

## Product contract

`POST /client/v1/conversations` means **start a consultation**. It is not the visitor-message endpoint.

A storefront CTA should therefore create the conversation immediately when the user chooses to start support. The visitor does not need to type a message first.

```text
CTA click
→ POST /client/v1/conversations
→ create conversation
→ attempt first agent assignment
→ first successful assignment creates one traffic receipt
→ optional assigned-agent greeting is resolved exactly once
→ return the conversation with any generated greeting
→ later visitor text uses /messages
```

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

`sourceHandoffId` remains the idempotency boundary for one CTA consultation. Retrying the same handoff returns the existing conversation and must not create a second conversation, traffic receipt, quota charge or greeting.

## Legacy create-with-message compatibility

Existing callers may continue to provide both:

```json
{
  "clientMessageId": "visitor-message-1",
  "message": "Hello"
}
```

The two fields are an optional pair. If either field is supplied, both must be valid. New storefront integrations should prefer CTA-only creation followed by the normal message endpoint.

## Visitor messages after start

Visitor text after the consultation exists uses:

```http
POST /client/v1/conversations/:id/messages
```

The message endpoint remains independently idempotent through `clientMessageId`.

## First reception and quota

A CTA click by itself does not consume a seat quota while the conversation is waiting.

The first successful agent assignment is the existing billing boundary:

```text
unassigned conversation
→ eligible agent selected
→ immutable agent_traffic_receipts row
→ daily reception count +1
→ paid traffic quota consumed once when enabled
```

Transfers, requeues, reconnects and retries cannot create a second traffic receipt and therefore cannot consume another consultation unit.

## Optional initial greeting

The assigned agent may enable a personal first greeting. It is optional and defaults off.

On the first traffic receipt, D1 resolves the `initial_greeting` automation once:

- configured and enabled: store `sent` and materialize one normal `agent` message;
- not configured or disabled: store `skipped` and create no message.

The automation receipt uses `(conversation_id, automation_key)` as its unique boundary. A later transfer, requeue, reconnect or settings change cannot send another initial greeting.

Existing conversations are migrated as `skipped`, so deploying the feature never sends retroactive greetings.

## New-consultation attention

The first effective assignment is also a seat-attention event. D1 ensures `agent_unread_count >= 1` at first reception.

This intentionally reuses the existing agent Inbox notification path:

- CTA with no visitor message: `0 → 1`, so the existing foreground tone fires once;
- legacy create with one visitor message: unread is already `1`, so it is not incremented to `2`;
- multiple queued visitor messages keep their actual unread count;
- opening/reading the conversation recalculates unread state from actual visitor messages and acknowledges the consultation event.

The automatically generated greeting does not create an agent-side sound event because it is the agent's own outgoing message.
