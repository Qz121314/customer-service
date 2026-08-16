export type AgentAssignment = {
  id: string;
  name: string;
};

const ROUTING_TIME_ZONE = 'America/Los_Angeles';

export function routingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROUTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

type ConversationRoutingRow = {
  site_id: string;
  product_id: string | null;
  section_id: string | null;
  category_id: string | null;
  assigned_agent: string | null;
};

/**
 * Assign one conversation to one currently-eligible agent.
 *
 * Routing is scope-native: product, section and category scopes are the only
 * assignment source. Candidate selection and the conversation write happen in
 * the same SQLite UPDATE statement, so concurrent requests cannot both pass a
 * stale capacity check before writing. Active load is balanced first; today's
 * accepted count is a secondary fairness signal; last_assigned_at and id make
 * equal-load ordering deterministic.
 */
export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
  excludedAgentId: string | null = null,
): Promise<AgentAssignment | null> {
  const conversation = await db
    .prepare(
      `SELECT
         c.site_id,
         c.product_id,
         COALESCE(c.section_id, p.section_id) AS section_id,
         COALESCE(c.category_id, p.category_id) AS category_id,
         c.assigned_agent
       FROM conversations c
       LEFT JOIN product_catalog p
         ON p.site_id = c.site_id
        AND p.id = c.product_id
       WHERE c.id = ?1
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(conversationId)
    .first<ConversationRoutingRow>();

  if (!conversation) return null;
  if (conversation.assigned_agent) {
    return assignedAgent(db, conversationId);
  }

  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));
  const result = await db
    .prepare(
      `WITH matching AS (
         SELECT DISTINCT ars.agent_id
         FROM agent_routing_scopes ars
         WHERE ars.site_id = ?1
           AND ars.is_enabled = 1
           AND (
             (?2 <> '' AND ars.scope_type = 'product' AND ars.product_id = ?2)
             OR (?3 <> '' AND ars.scope_type = 'section' AND ars.section_id = ?3)
             OR (
               ?3 <> ''
               AND ?4 <> ''
               AND ars.scope_type = 'category'
               AND ars.section_id = ?3
               AND ars.category_id = ?4
             )
           )
       ),
       candidate AS (
         SELECT a.id
         FROM matching m
         JOIN agents a
           ON a.id = m.agent_id
          AND a.site_id = ?1
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         LEFT JOIN agent_daily_stats daily
           ON daily.site_id = a.site_id
          AND daily.agent_id = a.id
          AND daily.business_date = ?7
         WHERE a.is_enabled = 1
           AND (?8 = '' OR a.id <> ?8)
           AND a.status = 'online'
           AND a.username IS NOT NULL
           AND a.password_hash IS NOT NULL
           AND a.last_seen_at IS NOT NULL
           AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')
           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
           AND (
             a.daily_conversation_limit = 0
             OR COALESCE(daily.conversation_count, 0) < a.daily_conversation_limit
           )
           AND (
             a.traffic_quota_enabled = 0
             OR a.traffic_quota_used < a.traffic_quota_total
           )
         ORDER BY
           COALESCE(load.active_count, 0) ASC,
           COALESCE(daily.conversation_count, 0) ASC,
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1
       )
       UPDATE conversations
       SET assigned_agent = (SELECT id FROM candidate),
           assigned_at = ?6,
           assigned_business_date = ?7,
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?6
       WHERE id = ?5
         AND assigned_agent IS NULL
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM candidate)`,
    )
    .bind(
      conversation.site_id,
      conversation.product_id ?? '',
      conversation.section_id ?? '',
      conversation.category_id ?? '',
      conversationId,
      now,
      businessDate,
      excludedAgentId ?? '',
    )
    .run();

  const assignment = await assignedAgent(db, conversationId);
  if (!assignment) return null;

  if (result.meta.changes) {
    await db
      .prepare(
        `UPDATE agents
         SET last_assigned_at = ?1, updated_at = ?1
         WHERE id = ?2 AND site_id = ?3`,
      )
      .bind(now, assignment.id, conversation.site_id)
      .run();
  }

  return assignment;
}

async function assignedAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignment | null> {
  return db
    .prepare(
      `SELECT a.id, a.name
       FROM conversations c
       JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1
       LIMIT 1`,
    )
    .bind(conversationId)
    .first<AgentAssignment>();
}
