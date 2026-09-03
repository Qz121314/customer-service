export type ClientConversationFanoutPlanInput = {
  conversationId: string;
  siteId: string;
  visitorId: string | null;
  assignedAgentId: string | null;
  previousAgentId?: string | null;
  includeAgentInbox: boolean;
};

export function clientConversationFanoutPlan(
  input: ClientConversationFanoutPlanInput,
) {
  const rooms = [
    input.conversationId,
    ...(input.visitorId ? [`client:${input.siteId}:${input.visitorId}`] : []),
  ];
  if (input.includeAgentInbox && input.assignedAgentId) {
    rooms.push(`agent-inbox:${input.assignedAgentId}`);
  }
  if (input.includeAgentInbox && input.previousAgentId) {
    rooms.push(`agent-inbox:${input.previousAgentId}`);
  }
  return rooms;
}
