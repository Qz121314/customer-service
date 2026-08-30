import { broadcastAssignments } from './assignment-broadcast';
import {
  assignConversationAgent,
  findRoutableWaitingConversationIds,
} from './routing';

type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

const MAX_RECOVERY_ASSIGNMENTS = 10;

/**
 * Recover conversations that could not be assigned when they were created.
 *
 * Agent presence is only a convenient recovery trigger here; the triggering
 * agent never receives preferential treatment. Discovery is delegated to the
 * canonical routing module and returns only rows that currently have at least
 * one eligible receiver, so permanently blocked head rows cannot starve newer
 * routable conversations.
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
  const waiting = await findRoutableWaitingConversationIds(env.DB, limit);

  const assignedConversationIds: string[] = [];
  for (const conversationId of waiting) {
    const assignment = await assignConversationAgent(env.DB, conversationId);
    if (!assignment?.newlyAssigned || !assignment.assignedAt) continue;

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
