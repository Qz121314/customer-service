const AGENT_NAVIGATION_KEY = '__customerServiceAgentView';

export type AgentMobileView =
  | 'workspace'
  | 'menu'
  | 'cards'
  | 'autoReply'
  | 'statistics';

type AgentSettingsView = Exclude<AgentMobileView, 'workspace'>;

type AgentThreadNavigationMarker = {
  view: 'thread';
  conversationId: string;
};

type AgentSettingsNavigationMarker = {
  view: AgentSettingsView;
};

export type AgentNavigationMarker =
  | AgentThreadNavigationMarker
  | AgentSettingsNavigationMarker;

type AgentNavigationListener = () => void;

const listeners = new Set<AgentNavigationListener>();
let listenerInstalled = false;
let resetInFlight = false;
let pendingDestination: AgentNavigationMarker | null | undefined;

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {};
}

function isSettingsView(value: unknown): value is AgentSettingsView {
  return (
    value === 'menu' ||
    value === 'cards' ||
    value === 'autoReply' ||
    value === 'statistics'
  );
}

function historyDepth(marker: AgentNavigationMarker): number {
  if (marker.view === 'thread' || marker.view === 'menu') return 1;
  return 2;
}

function markerState(marker: AgentNavigationMarker): Record<string, unknown> {
  return {
    ...historyStateRecord(),
    [AGENT_NAVIGATION_KEY]: marker,
  };
}

function emitNavigationChange() {
  for (const listener of listeners) listener();
}

function pushMarker(marker: AgentNavigationMarker) {
  window.history.pushState(markerState(marker), '', window.location.href);
}

function replaceMarker(marker: AgentNavigationMarker) {
  window.history.replaceState(markerState(marker), '', window.location.href);
}

function pushDestination(marker: AgentNavigationMarker) {
  if (
    marker.view !== 'thread' &&
    marker.view !== 'menu' &&
    readAgentNavigationMarker()?.view !== 'menu'
  ) {
    pushMarker({ view: 'menu' });
  }
  pushMarker(marker);
  emitNavigationChange();
}

function completePendingReset() {
  const destination = pendingDestination;
  resetInFlight = false;
  pendingDestination = undefined;
  if (destination) {
    pushDestination(destination);
    return;
  }
  emitNavigationChange();
}

function handlePopState() {
  if (resetInFlight && !readAgentNavigationMarker()) {
    completePendingReset();
    return;
  }
  emitNavigationChange();
}

function ensureNavigationListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener('popstate', handlePopState);
}

function resetTo(destination: AgentNavigationMarker | null) {
  const marker = readAgentNavigationMarker();
  pendingDestination = destination;
  if (!marker) {
    completePendingReset();
    return;
  }
  resetInFlight = true;
  window.history.go(-historyDepth(marker));
}

export function readAgentNavigationMarker(): AgentNavigationMarker | null {
  const marker = historyStateRecord()[AGENT_NAVIGATION_KEY];
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
    return null;
  }
  const record = marker as Record<string, unknown>;
  if (record.view === 'thread') {
    return typeof record.conversationId === 'string' && record.conversationId
      ? { view: 'thread', conversationId: record.conversationId }
      : null;
  }
  return isSettingsView(record.view) ? { view: record.view } : null;
}

export function readAgentMobileView(): AgentMobileView {
  const marker = readAgentNavigationMarker();
  return marker && marker.view !== 'thread' ? marker.view : 'workspace';
}

export function subscribeAgentNavigation(listener: AgentNavigationListener) {
  ensureNavigationListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function navigateAgentSettings(view: AgentSettingsView) {
  ensureNavigationListener();
  const current = readAgentNavigationMarker();
  if (resetInFlight) {
    pendingDestination = { view };
    return;
  }
  if (!current) {
    pushDestination({ view });
    return;
  }
  if (current.view === 'thread') {
    resetTo({ view });
    return;
  }
  if (current.view === view) return;
  if (view === 'menu') {
    window.history.go(-(historyDepth(current) - 1));
    return;
  }
  if (current.view === 'menu') {
    pushMarker({ view });
    emitNavigationChange();
    return;
  }
  replaceMarker({ view });
  emitNavigationChange();
}

export function navigateAgentWorkspace() {
  ensureNavigationListener();
  if (resetInFlight) {
    pendingDestination = null;
    return;
  }
  resetTo(null);
}

export function navigateAgentBack(): boolean {
  ensureNavigationListener();
  if (!readAgentNavigationMarker()) return false;
  window.history.back();
  return true;
}

export function rememberAgentConversationHistory(
  conversationId: string,
  threadAlreadyOpen: boolean,
): boolean {
  ensureNavigationListener();
  const current = readAgentNavigationMarker();
  const destination: AgentThreadNavigationMarker = {
    view: 'thread',
    conversationId,
  };

  if (resetInFlight) {
    pendingDestination = destination;
    return false;
  }
  if (current?.view === 'thread') {
    if (current.conversationId !== conversationId || threadAlreadyOpen) {
      replaceMarker(destination);
      emitNavigationChange();
    }
    return true;
  }
  if (current) {
    resetTo(destination);
    return false;
  }
  pushMarker(destination);
  emitNavigationChange();
  return true;
}
