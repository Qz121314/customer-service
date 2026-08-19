import { broadcastAssignments } from './assignment-broadcast';
import { routingBusinessDate } from './routing';

type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

const MAX_RECOVERY_ASSIGNMENTS = 10;

export async function assignWaitingConversations(
  env: WaitingAssignmentEnv,
  agentId: string,
  requestedLimit = MAX_RECOVERY_ASSIGNMENTS,
): Promise<string[]> {
  const limit = Math.max(
    1,
    Math.min(MAX_RECOVERY_ASSIGNMENTS, Math.trunc(requestedLimit)),
  );
  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));

  // Claim matching conversations in one atomic SQLite statement. Already-counted
  // conversations are recovered first because they must not require or consume
  // another daily/new-traffic unit. Fresh traffic then fills only the remaining
  // active capacity allowed by today's and the paid traffic quota. A conversation
  // manually returned to routing stays excluded from its previous seat until a
  // different seat actually accepts it.
  const assigned = await env.DB.prepare(
    `WITH agent_state AS (
       SELECT
         a.id,
         a.site_id,
         a.max_active_conversations,
         a.daily_conversation_limit,
         a.traffic_quota_enabled,
         a.traffic_quota_total,
         a.traffic_quota_used,
         (
           SELECT COUNT(*)
           FROM conversations active
           WHERE active.site_id = a.site_id
             AND active.assigned_agent = a.id
             AND active.status IN ('open', 'pending')
             AND active.expires_at > CURRENT_TIMESTAMP
         ) AS active_count,
         COALESCE((
           SELECT daily.conversation_count
           FROM agent_daily_stats daily
           WHERE daily.site_id = a.site_id
             AND daily.agent_id = a.id
             AND daily.business_date = ?3
           LIMIT 1
         ), 0) AS daily_count
       FROM agents a
       WHERE a.id = ?1
         AND a.is_enabled = 1
         AND a.status = 'online'
         AND a.username IS NOT NULL
         AND a.password_hash IS NOT NULL
         AND a.last_seen_at IS NOT NULL
         AND datetime(a.last_seen_at) >= datetime('now', '-3 minutes')
       LIMIT 1
     ),
     capacity AS (
       SELECT
         MIN(
           ?2,
           CASE
             WHEN max_active_conversations = 0 THEN ?2
             ELSE MAX(max_active_conversations - active_count, 0)
           END
         ) AS overall_remaining,
         MIN(
           ?2,
           CASE
             WHEN daily_conversation_limit = 0 THEN ?2
             ELSE MAX(daily_conversation_limit - daily_count, 0)
           END,
           CASE
             WHEN traffic_quota_enabled = 0 THEN ?2
             ELSE MAX(traffic_quota_total - traffic_quota_used, 0)
           END
         ) AS new_traffic_remaining
       FROM agent_state
     ),
     waiting_base AS (
       SELECT
         c.id,
         c.last_message_at,
         CASE WHEN EXISTS (
           SELECT 1
           FROM agent_traffic_receipts receipt
           WHERE receipt.conversation_id = c.id
         ) THEN 1 ELSE 0 END AS already_received
       FROM conversations c
       WHERE c.site_id = (SELECT site_id FROM agent_state)
         AND c.assigned_agent IS NULL
         AND c.status IN ('open', 'pending')
         AND (
           c.requeue_excluded_agent_id IS NULL
           OR c.requeue_excluded_agent_id <> ?1
         )
         AND c.expires_at > CURRENT_TIMESTAMP
         AND EXISTS (
           SELECT 1
           FROM agent_routing_scopes ars
           WHERE ars.site_id = c.site_id
             AND ars.agent_id = ?1
             AND ars.is_enabled = 1
             AND (
               (ars.scope_type = 'product' AND ars.product_id = c.product_id)
               OR (ars.scope_type = 'section' AND ars.section_id = c.section_id)
               OR (
                 ars.scope_type = 'category'
                 AND ars.section_id = c.section_id
                 AND ars.category_id = c.category_id
               )
             )
         )
     ),
     waiting_ranked AS (
       SELECT
         id,
         last_message_at,
         already_received,
         ROW_NUMBER() OVER (
           PARTITION BY already_received
           ORDER BY last_message_at ASC, id ASC
         ) AS traffic_rank
       FROM waiting_base
     ),
     waiting AS (
       SELECT id
       FROM waiting_ranked
       WHERE already_received = 1
         OR traffic_rank <= COALESCE(
           (SELECT new_traffic_remaining FROM capacity),
           0
         )
       ORDER BY already_received DESC, last_message_at ASC, id ASC
       LIMIT COALESCE((SELECT overall_remaining FROM capacity), 0)
     )
     UPDATE conversations
     SET assigned_agent = ?1,
         assigned_at = ?4,
         assigned_business_date = ?3,
         status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
         updated_at = ?4
     WHERE id IN (SELECT id FROM waiting)
       AND assigned_agent IS NULL
       AND status IN ('open', 'pending')
       AND expires_at > CURRENT_TIMESTAMP
     RETURNING id`,
  )
    .bind(agentId, limit, businessDate, now)
    .all<{ id: string }>();

  const assignedConversationIds = (assigned.results ?? []).map((row) => row.id);
  if (assignedConversationIds.length === 0) return [];

  await env.DB.prepare(
    `UPDATE agents
     SET last_assigned_at = ?1, updated_at = ?1
     WHERE id = ?2`,
  )
    .bind(now, agentId)
    .run();

  await broadcastAssignments(env, agentId, assignedConversationIds, now);
  return assignedConversationIds;
}
