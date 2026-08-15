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
  group_id: string | null;
  assigned_agent: string | null;
};

/**
 * Assign one conversation to one currently-eligible agent.
 *
 * The candidate selection and conversation write happen in the same SQLite
 * UPDATE statement, so concurrent requests cannot both pass a stale capacity
 * check before writing. Active load is balanced first; last_assigned_at and id
 * provide deterministic round-robin ordering for equal loads. Legacy groups
 * are considered only when no hierarchical routing scope matches at all.
 */
export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignment | null> {
  const conversation = await db
    .prepare(
      `SELECT
         c.site_id,
         c.product_id,
         COALESCE(c.section_id, p.section_id) AS section_id,
         COALESCE(c.category_id, p.category_id) AS category_id,
         c.group_id,
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
       scoped_candidate AS (
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
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS daily_count
           FROM conversations
           WHERE site_id = ?1
             AND assigned_agent IS NOT NULL
             AND assigned_business_date = ?8
           GROUP BY assigned_agent
         ) daily ON daily.assigned_agent = a.id
         WHERE a.is_enabled = 1
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
             OR COALESCE(daily.daily_count, 0) < a.daily_conversation_limit
           )
         ORDER BY
           COALESCE(daily.daily_count, 0) ASC,
           COALESCE(load.active_count, 0) ASC,
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1
       ),
       legacy_candidate AS (
         SELECT a.id
         FROM group_agents ga
         JOIN agents a
           ON a.id = ga.agent_id
          AND a.site_id = ga.site_id
         JOIN support_groups sg
           ON sg.site_id = ga.site_id
          AND sg.id = ga.group_id
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS daily_count
           FROM conversations
           WHERE site_id = ?1
             AND assigned_agent IS NOT NULL
             AND assigned_business_date = ?8
           GROUP BY assigned_agent
         ) daily ON daily.assigned_agent = a.id
         WHERE ?5 <> ''
           AND NOT EXISTS (SELECT 1 FROM matching)
           AND ga.site_id = ?1
           AND ga.group_id = ?5
           AND ga.is_enabled = 1
           AND sg.is_enabled = 1
           AND a.is_enabled = 1
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
             OR COALESCE(daily.daily_count, 0) < a.daily_conversation_limit
           )
         ORDER BY
           COALESCE(daily.daily_count, 0) ASC,
           COALESCE(load.active_count, 0) ASC,
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1
       ),
       candidate AS (
         SELECT id FROM scoped_candidate
         UNION ALL
         SELECT id FROM legacy_candidate
         LIMIT 1
       )
       UPDATE conversations
       SET assigned_agent = (SELECT id FROM candidate),
           assigned_at = ?7,
           assigned_business_date = ?8,
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?7
       WHERE id = ?6
         AND assigned_agent IS NULL
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND EXISTS (SELECT 1 FROM candidate)`,
    )
    .bind(
      conversation.site_id,
      conversation.product_id ?? '',
      conversation.section_id ?? '',
      conversation.category_id ?? '',
      conversation.group_id ?? '',
      conversationId,
      now,
      businessDate,
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
