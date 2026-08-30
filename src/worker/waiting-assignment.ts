type WaitingAssignmentEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

/**
 * Waiting-queue recovery was removed from the product contract. Existing call
 * sites are intentionally kept side-effect free during the compatibility window
 * so login, heartbeat, status changes and quota edits cannot revive old rows.
 */
export async function assignWaitingConversations(
  _env: WaitingAssignmentEnv,
  _triggerAgentId: string,
  _requestedLimit?: number,
): Promise<string[]> {
  return [];
}
