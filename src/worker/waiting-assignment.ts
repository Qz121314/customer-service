import { broadcastAssignments } from './assignment-broadcast';
import { recoverWaitingConversationAssignments } from './routing';

type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

const MAX_RECOVERY_ASSIGNMENTS = 10;

/**
 * Recover conversations that could not be assigned when they were created.
 *
 * Agent presence is only a convenient recovery trigger here; the triggering
 * agent never receives preferential treatment. The canonical routing module
 * scans beyond blocked head rows and owns every eligibility and round-robin
 * decision.
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
  const recovered = await recoverWaitingConversationAssignments(env.DB, limit);

  const assignedConversationIds: string[] = [];
  for (const { conversationId, assignment } of recovered) {
    await broadcastAssignments(
      env,
      assignment.id,
      [conversationId],
      assignment.assignedAt,
    );
    assignedConversationIds.push(conversationId);
  }
  return assignedConversationIds;
}
