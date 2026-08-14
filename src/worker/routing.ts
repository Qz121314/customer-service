export type AgentAssignment = {
  id: string;
  name: string;
};

type ConversationRoutingRow = {
  site_id: string;
  product_id: string | null;
  section_id: string | null;
  category_id: string | null;
  group_id: string | null;
  assigned_agent: string | null;
};

type ScopeCandidateRow = {
  configured: number;
  id: string | null;
  name: string | null;
};

type AgentCandidateRow = {
  id: string;
  name: string;
};

/**
 * Assign one conversation to an available agent responsible for its scope.
 *
 * Routing policy:
 * 1. admin assigns a whole section, selected categories, or explicit products;
 * 2. section/category rules match dynamically, so newly synced products require
 *    no extra configuration request;
 * 3. only enabled agents with a fresh online heartbeat participate;
 * 4. respect per-agent active conversation capacity;
 * 5. round-robin by least recently assigned agent with a stable id tie-breaker.
 *
 * Legacy group membership is used only when no agent routing scope matches the
 * conversation. Once a scope is configured, an unavailable agent never causes
 * fallback into the legacy group.
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
    return db
      .prepare(
        `SELECT id, name
         FROM agents
         WHERE id = ?1 AND site_id = ?2
         LIMIT 1`,
      )
      .bind(conversation.assigned_agent, conversation.site_id)
      .first<AgentAssignment>();
  }

  const scoped = await db
    .prepare(
      `WITH matching AS (
         SELECT DISTINCT ars.agent_id
         FROM agent_routing_scopes ars
         WHERE ars.site_id = ?1
           AND ars.is_enabled = 1
           AND (
             (
               ?2 <> ''
               AND ars.scope_type = 'product'
               AND ars.product_id = ?2
             )
             OR (
               ?3 <> ''
               AND ars.scope_type = 'section'
               AND ars.section_id = ?3
             )
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
         SELECT a.id, a.name
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
         ORDER BY
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1
       )
       SELECT
         CASE WHEN EXISTS(SELECT 1 FROM matching) THEN 1 ELSE 0 END AS configured,
         candidate.id,
         candidate.name
       FROM (SELECT 1) seed
       LEFT JOIN candidate ON 1 = 1
       LIMIT 1`,
    )
    .bind(
      conversation.site_id,
      conversation.product_id ?? '',
      conversation.section_id ?? '',
      conversation.category_id ?? '',
    )
    .first<ScopeCandidateRow>();

  const hasScopeRouting = scoped?.configured === 1;
  let candidate: AgentCandidateRow | null =
    scoped?.id && scoped.name ? { id: scoped.id, name: scoped.name } : null;

  if (!candidate && !hasScopeRouting && conversation.group_id) {
    candidate = await db
      .prepare(
        `SELECT a.id, a.name
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
         WHERE ga.site_id = ?1
           AND ga.group_id = ?2
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
         ORDER BY
           COALESCE(a.last_assigned_at, '') ASC,
           a.id ASC
         LIMIT 1`,
      )
      .bind(conversation.site_id, conversation.group_id)
      .first<AgentCandidateRow>();
  }

  if (!candidate) return null;

  const now = new Date().toISOString();
  const assignment = await db
    .prepare(
      `UPDATE conversations
       SET assigned_agent = ?1,
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?2
       WHERE id = ?3 AND assigned_agent IS NULL
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
    )
    .bind(candidate.id, now, conversationId)
    .run();
  if (!assignment.meta.changes) return null;

  await db
    .prepare(
      `UPDATE agents
       SET last_assigned_at = ?1, updated_at = ?1
       WHERE id = ?2 AND site_id = ?3`,
    )
    .bind(now, candidate.id, conversation.site_id)
    .run();

  return { id: candidate.id, name: candidate.name };
}
