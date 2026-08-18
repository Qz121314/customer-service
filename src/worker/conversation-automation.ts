export type ConversationAutomationMessage = {
  id: string;
  conversation_id: string;
  sender_type: 'agent';
  sender_id: string;
  body: string;
  client_message_id: string;
  read_by_visitor_at: null;
  read_by_agent_at: null;
  created_at: string;
};

type AutomationReceiptRow = {
  conversation_id: string;
  agent_id: string | null;
  message_id: string | null;
  message_body: string | null;
  resolved_at: string;
};

const INITIAL_GREETING_KEY = 'initial_greeting';
const INITIAL_GREETING_MESSAGE_KEY = 'auto-greeting:v1';

/**
 * Resolve the first-assignment greeting decision for a batch of conversations.
 *
 * The database receipt is the idempotency boundary. A row is inserted even when
 * the assigned agent has no greeting configured, which permanently records that
 * the first-assignment automation was evaluated and intentionally skipped.
 *
 * The migration trigger materializes enabled greetings as normal agent messages
 * in the same database transaction as the automation receipt.
 */
export async function resolveInitialGreetingAutomations(
  db: D1Database,
  conversationIds: string[],
): Promise<ConversationAutomationMessage[]> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const resolvedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO conversation_automation_receipts (
         conversation_id,
         automation_key,
         agent_id,
         message_id,
         message_body,
         resolved_at
       )
       SELECT
         c.id,
         ?2,
         c.assigned_agent,
         CASE
           WHEN a.auto_greeting_enabled = 1
            AND length(trim(COALESCE(a.auto_greeting_text, ''))) > 0
           THEN 'auto-greeting:' || c.id
           ELSE NULL
         END,
         CASE
           WHEN a.auto_greeting_enabled = 1
            AND length(trim(COALESCE(a.auto_greeting_text, ''))) > 0
           THEN trim(a.auto_greeting_text)
           ELSE NULL
         END,
         ?3
       FROM conversations c
       JOIN agent_traffic_receipts receipt
         ON receipt.conversation_id = c.id
        AND receipt.agent_id = c.assigned_agent
       JOIN agents a
         ON a.id = c.assigned_agent
        AND a.site_id = c.site_id
       WHERE c.id IN (
         SELECT CAST(value AS TEXT) FROM json_each(?1)
       )
         AND c.assigned_agent IS NOT NULL
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       RETURNING conversation_id, agent_id, message_id, message_body, resolved_at`,
    )
    .bind(JSON.stringify(ids), INITIAL_GREETING_KEY, resolvedAt)
    .all<AutomationReceiptRow>();

  return (result.results ?? []).flatMap((row) => {
    if (!row.agent_id || !row.message_id || !row.message_body) return [];
    return [
      {
        id: row.message_id,
        conversation_id: row.conversation_id,
        sender_type: 'agent' as const,
        sender_id: row.agent_id,
        body: row.message_body,
        client_message_id: INITIAL_GREETING_MESSAGE_KEY,
        read_by_visitor_at: null,
        read_by_agent_at: null,
        created_at: row.resolved_at,
      },
    ];
  });
}
