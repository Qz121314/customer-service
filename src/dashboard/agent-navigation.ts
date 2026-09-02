import { useCallback, useEffect, useRef, useState } from 'react';

const AGENT_NAVIGATION_KEY = '__customerServiceAgentNavigation';

export type AgentWorkspaceView =
  { kind: 'inbox' } | { kind: 'thread'; conversationId: string };

export type AgentOverlayView =
  'none' | 'menu' | 'cards' | 'autoReply' | 'statistics';

export type AgentNavigationState = {
  workspace: AgentWorkspaceView;
  overlay: AgentOverlayView;
};

const inboxNavigationState: AgentNavigationState = {
  workspace: { kind: 'inbox' },
  overlay: 'none',
};

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

function readWorkspaceView(value: unknown): AgentWorkspaceView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind === 'inbox') return { kind: 'inbox' };
  if (
    record.kind === 'thread' &&
    typeof record.conversationId === 'string' &&
    record.conversationId
  ) {
    return { kind: 'thread', conversationId: record.conversationId };
  }
  return null;
}

function readOverlayView(value: unknown): AgentOverlayView | null {
  return value === 'none' ||
    value === 'menu' ||
    value === 'cards' ||
    value === 'autoReply' ||
    value === 'statistics'
    ? value
    : null;
}

export function readAgentNavigationState(): AgentNavigationState | null {
  const marker = historyStateRecord()[AGENT_NAVIGATION_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return null;
  }
  const record = marker as Record<string, unknown>;
  const workspace = readWorkspaceView(record.workspace);
  const overlay = readOverlayView(record.overlay);
  return workspace && overlay ? { workspace, overlay } : null;
}

function writeHistoryState(
  navigation: AgentNavigationState,
  mode: 'push' | 'replace',
) {
  const nextState = {
    ...historyStateRecord(),
    [AGENT_NAVIGATION_KEY]: navigation,
  };
  if (mode === 'push') {
    window.history.pushState(nextState, '', window.location.href);
    return;
  }
  window.history.replaceState(nextState, '', window.location.href);
}

function sameNavigation(
  left: AgentNavigationState,
  right: AgentNavigationState,
) {
  const leftConversationId =
    left.workspace.kind === 'thread' ? left.workspace.conversationId : null;
  const rightConversationId =
    right.workspace.kind === 'thread' ? right.workspace.conversationId : null;
  return (
    left.overlay === right.overlay &&
    left.workspace.kind === right.workspace.kind &&
    leftConversationId === rightConversationId
  );
}

export function useAgentNavigation() {
  const [navigation, setNavigation] = useState<AgentNavigationState>(
    () => readAgentNavigationState() ?? inboxNavigationState,
  );
  const navigationRef = useRef(navigation);

  useEffect(() => {
    document.body.style.overscrollBehaviorX = 'auto';
    const initial = readAgentNavigationState() ?? inboxNavigationState;
    navigationRef.current = initial;
    setNavigation(initial);
    writeHistoryState(initial, 'replace');

    const restoreFromHistory = () => {
      const restored = readAgentNavigationState() ?? inboxNavigationState;
      navigationRef.current = restored;
      setNavigation(restored);
    };
    window.addEventListener('popstate', restoreFromHistory);
    return () => {
      window.removeEventListener('popstate', restoreFromHistory);
      document.body.style.removeProperty('overscroll-behavior-x');
    };
  }, []);

  const navigate = useCallback((next: AgentNavigationState) => {
    if (sameNavigation(navigationRef.current, next)) return;
    navigationRef.current = next;
    setNavigation(next);
    writeHistoryState(next, 'push');
  }, []);

  const replace = useCallback((next: AgentNavigationState) => {
    navigationRef.current = next;
    setNavigation(next);
    writeHistoryState(next, 'replace');
  }, []);

  const back = useCallback(() => window.history.back(), []);

  return { navigation, navigate, replace, back };
}

export function inboxRoute(): AgentNavigationState {
  return inboxNavigationState;
}

export function threadRoute(conversationId: string): AgentNavigationState {
  return {
    workspace: { kind: 'thread', conversationId },
    overlay: 'none',
  };
}

export function withOverlay(
  navigation: AgentNavigationState,
  overlay: Exclude<AgentOverlayView, 'none'>,
): AgentNavigationState {
  return { ...navigation, overlay };
}
