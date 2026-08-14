export type AgentAssignment = {
  id: string;
  name: string;
};

type ConversationRoutingRow = {
  site_id: string;
  product_id: string | null;
  group_id: string | null;
  assigned_agent: string | null;
};

type AgentCandidateRow = {
  id: string;
  name: string;
};

/**
 * Assign one conversation to an available agent responsible for its product.
 *
 * Product routing policy:
 * 1. admin assigns products to agents;
 * 2. only enabled agents with a fresh online heartbeat participate;
 * 3. respect per-agent active conversation capacity;
 * 4. round-robin by least recently assigned agent;
 * 5. stable id tie-breaker for deterministic first assignment.
 *
 * Legacy group membership is used only when a product has no product-agent
 * assignments yet. This keeps conversations flowing during migration; once an
 * admin assigns the product to at least one agent, groups no longer participate
 * in routing for that product.
 */
export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignment | null> {
  const conversation = await db
    .prepare(
      `SELECT site_id, product_id, group_id, assigned_agent
       FROM conversations
       WHERE id = ?1
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
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

  let candidate: AgentCandidateRow | null = null;
  let hasProductRouting = false;

  if (conversation.product_id) {
    const configured = await db
      .prepare(
        `SELECT 1 AS configured
         FROM agent_products
         WHERE site_id = ?1 AND product_id = ?2 AND is_enabled = 1
         LIMIT 1`,
      )
      .bind(conversation.site_id, conversation.product_id)
      .first<{ configured: number }>();
    hasProductRouting = Boolean(configured);

    if (hasProductRouting) {
      candidate = await db
        .prepare(
          `SELECT a.id, a.name
           FROM agent_products ap
           JOIN agents a
             ON a.id = ap.agent_id
            AND a.site_id = ap.site_id
           LEFT JOIN (
             SELECT assigned_agent, COUNT(*) AS active_count
             FROM conversations
             WHERE status IN ('open', 'pending')
               AND assigned_agent IS NOT NULL
               AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
             GROUP BY assigned_agent
           ) load ON load.assigned_agent = a.id
           WHERE ap.site_id = ?1
             AND ap.product_id = ?2
             AND ap.is_enabled = 1
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
        .bind(conversation.site_id, conversation.product_id)
        .first<AgentCandidateRow>();
    }
  }

  if (!candidate && !hasProductRouting && conversation.group_id) {
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
           WHERE status IN ('open', 'pending')
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
