import { broadcastAssignments } from './assignment-broadcast';
import { assignConversationAgent } from './routing';

type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

const MAX_RECOVERY_ASSIGNMENTS = 10;

/**
 * Recover conversations that could not be assigned when they were created.
 *
 * Agent presence is only a convenient recovery trigger here; the triggering
 * agent never receives preferential treatment. Every waiting conversation goes
 * back through the canonical scope + enabled + quota + CTA affinity + round
 * robin routing function, so online/offline state cannot change ownership.
 */
export async function assignWaitingConversations(
  env: WaitingAssignmentEnv,
  _triggerAgentId: string,
  requestedLimit = MAX_RECOVERY_ASSIGNMENTS,
): Promise<string[]> {
  const limit = Math.max(
    1,
    Math.min(MAX_RECOVERY_ASSIGNMENTS, Math.trunc(requestedLimit)),
  );
  const waiting = await env.DB.prepare(
    `SELECT id
     FROM conversations
     WHERE assigned_agent IS NULL
       AND status IN ('open', 'pending')
       AND expires_at > CURRENT_TIMESTAMP
     ORDER BY last_message_at ASC, id ASC
     LIMIT ?1`,
  )
    .bind(limit)
    .all<{ id: string }>();

  const assignedConversationIds: string[] = [];
  for (const row of waiting.results ?? []) {
    const assignment = await assignConversationAgent(env.DB, row.id);
    if (!assignment?.newlyAssigned || !assignment.assignedAt) continue;

    await broadcastAssignments(
      env,
      assignment.id,
      [row.id],
      assignment.assignedAt,
    );
    assignedConversationIds.push(row.id);
  }
  return assignedConversationIds;
}
