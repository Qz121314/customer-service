const AGENT_HISTORY_KEY = '__customerServiceAgentView';

type AgentThreadHistoryMarker = {
  view: 'thread';
  conversationId: string;
};

type AgentThreadHistoryState = AgentThreadHistoryMarker | null;

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

export function readAgentThreadHistoryMarker(): AgentThreadHistoryState {
  const marker = historyStateRecord()[AGENT_HISTORY_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return null;
  }
  const record = marker as Record<string, unknown>;
  if (
    record.view !== 'thread' ||
    typeof record.conversationId !== 'string' ||
    !record.conversationId
  ) {
    return null;
  }
  return { view: 'thread', conversationId: record.conversationId };
}

export function clearAgentThreadHistoryMarker() {
  if (!readAgentThreadHistoryMarker()) return;
  const state = { ...historyStateRecord() };
  delete state[AGENT_HISTORY_KEY];
  window.history.replaceState(state, '', window.location.href);
}

export function rememberAgentConversationHistory(
  conversationId: string,
  threadAlreadyOpen: boolean,
) {
  if (readAgentThreadHistoryMarker()?.conversationId === conversationId) {
    return;
  }
  const nextState = {
    ...historyStateRecord(),
    [AGENT_HISTORY_KEY]: { view: 'thread', conversationId },
  };
  if (threadAlreadyOpen) {
    window.history.replaceState(nextState, '', window.location.href);
    return;
  }
  window.history.pushState(nextState, '', window.location.href);
}
