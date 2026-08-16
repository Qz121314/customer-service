import { broadcastWaitingAssignments } from './assignment-broadcast';
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

  // Claim as many matching conversations as this seat can still receive in one
  // atomic SQLite statement. D1 serializes the statement, so capacity, daily
  // quota and paid traffic quota are evaluated against current database state.
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
             AND COALESCE(active.expires_at, datetime(active.created_at, '+1 day')) > CURRENT_TIMESTAMP
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
         AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')
       LIMIT 1
     ),
     capacity AS (
       SELECT MIN(
         ?2,
         CASE
           WHEN max_active_conversations = 0 THEN ?2
           ELSE MAX(max_active_conversations - active_count, 0)
         END,
         CASE
           WHEN daily_conversation_limit = 0 THEN ?2
           ELSE MAX(daily_conversation_limit - daily_count, 0)
         END,
         CASE
           WHEN traffic_quota_enabled = 0 THEN ?2
           ELSE MAX(traffic_quota_total - traffic_quota_used, 0)
         END
       ) AS remaining
       FROM agent_state
     ),
     waiting AS (
       SELECT DISTINCT c.id
       FROM conversations c
       WHERE c.site_id = (SELECT site_id FROM agent_state)
         AND c.assigned_agent IS NULL
         AND c.status IN ('open', 'pending')
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
         AND (
           EXISTS (
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
           OR (
             NOT EXISTS (
               SELECT 1
               FROM agent_routing_scopes configured
               WHERE configured.site_id = c.site_id
                 AND configured.is_enabled = 1
                 AND (
                   (configured.scope_type = 'product' AND configured.product_id = c.product_id)
                   OR (configured.scope_type = 'section' AND configured.section_id = c.section_id)
                   OR (
                     configured.scope_type = 'category'
                     AND configured.section_id = c.section_id
                     AND configured.category_id = c.category_id
                   )
                 )
             )
             AND EXISTS (
               SELECT 1
               FROM group_agents ga
               JOIN support_groups sg
                 ON sg.site_id = ga.site_id AND sg.id = ga.group_id
               WHERE ga.site_id = c.site_id
                 AND ga.group_id = c.group_id
                 AND ga.agent_id = ?1
                 AND ga.is_enabled = 1
                 AND sg.is_enabled = 1
             )
           )
         )
       ORDER BY c.last_message_at ASC, c.id ASC
       LIMIT COALESCE((SELECT remaining FROM capacity), 0)
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
       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
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

  await broadcastWaitingAssignments(env, agentId, assignedConversationIds);
  return assignedConversationIds;
}
