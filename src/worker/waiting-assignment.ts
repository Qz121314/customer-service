import { broadcastClientConversationEvent } from './client-api';
import { assignConversationAgent } from './routing';

type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

export async function assignWaitingConversations(
  env: WaitingAssignmentEnv,
  agentId: string,
  requestedLimit = 20,
): Promise<string[]> {
  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit)));
  const waiting = await env.DB.prepare(
    `SELECT DISTINCT c.id
     FROM conversations c
     WHERE c.assigned_agent IS NULL
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
     LIMIT ?2`,
  )
    .bind(agentId, limit)
    .all<{ id: string }>();

  const assignedConversationIds: string[] = [];
  for (const conversation of waiting.results ?? []) {
    const assignment = await assignConversationAgent(env.DB, conversation.id);
    if (!assignment) continue;
    assignedConversationIds.push(conversation.id);
    await broadcastClientConversationEvent(
      env,
      conversation.id,
      'conversation.assigned',
    );
  }
  return assignedConversationIds;
}
