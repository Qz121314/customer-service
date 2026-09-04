export type AgentNotificationState =
  'unsupported' | 'install-required' | 'disabled' | 'blocked' | 'enabled';

const AGENT_NOTIFICATION_PARAM = 'notification';
const AGENT_NOTIFICATION_TARGET = 'latest-unread';
const AGENT_NOTIFICATION_MESSAGE_TYPE = 'agent.notification.open';
const AGENT_SERVICE_WORKER_SCOPE = '/agent';
const AGENT_PUSH_BINDING_KEY = 'cs-agent-push-binding:v4';
const AGENT_SERVICE_WORKER_READY_TIMEOUT_MS = 15_000;

type PushConfig = {
  enabled: boolean;
  applicationServerKey: string;
};

type NotificationConversation = {
  id: string;
  agent_unread_count: number;
  last_message_at: string;
  created_at: string;
};

export function runBestEffortAgentCapability(
  action: () => void | Promise<void>,
): void {
  try {
    const task = action();
    void task?.catch(() => undefined);
  } catch {
    // Browser notification capabilities must never affect the core workspace.
  }
}

export function resolveAgentNotificationConversation<
  T extends NotificationConversation,
>(conversations: T[], targetId: string): T | null {
  if (targetId !== AGENT_NOTIFICATION_TARGET) {
    const exact = conversations.find(
      (conversation) => conversation.id === targetId,
    );
    if (exact) return exact;
  }
  return (
    conversations
      .filter((conversation) => conversation.agent_unread_count > 0)
      .sort((left, right) => {
        const leftTime = Date.parse(left.last_message_at || left.created_at);
        const rightTime = Date.parse(right.last_message_at || right.created_at);
        return rightTime - leftTime;
      })[0] ?? null
  );
}

export function hasAgentNotificationOpenIntent(): boolean {
  return agentNotificationOpenTarget() !== null;
}

export function agentNotificationOpenTarget(): string | null {
  const params = new URLSearchParams(window.location.search);
  const conversationId = params.get('conversationId')?.trim();
  if (conversationId) return conversationId;
  return params.get(AGENT_NOTIFICATION_PARAM) === AGENT_NOTIFICATION_TARGET
    ? AGENT_NOTIFICATION_TARGET
    : null;
}

export function clearAgentNotificationOpenIntent(): void {
  const url = new URL(window.location.href);
  if (!agentNotificationOpenTarget()) return;
  url.searchParams.delete(AGENT_NOTIFICATION_PARAM);
  url.searchParams.delete('conversationId');
  url.searchParams.delete('messageId');
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function isAgentNotificationOpenMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === AGENT_NOTIFICATION_MESSAGE_TYPE;
}

export function agentNotificationMessageTarget(value: unknown): string | null {
  if (!isAgentNotificationOpenMessage(value)) return null;
  const conversationId = (value as Record<string, unknown>).conversationId;
  return typeof conversationId === 'string' && conversationId
    ? conversationId
    : AGENT_NOTIFICATION_TARGET;
}

export async function prepareAgentNotifications(
  agentId: string,
): Promise<AgentNotificationState> {
  const prerequisite = notificationPrerequisite();
  if (prerequisite) return prerequisite;
  const registration = await agentServiceWorkerRegistration();
  if (Notification.permission === 'denied') return 'blocked';

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription && Notification.permission === 'granted') {
    try {
      subscription = await createAgentPushSubscription(registration);
    } catch (error) {
      console.warn('Agent push subscription repair failed.', error);
    }
  }
  if (!subscription) return 'disabled';

  await bindAgentSubscription(subscription, agentId);
  return 'enabled';
}

export async function enableAgentNotifications(
  agentId: string,
): Promise<AgentNotificationState> {
  const prerequisite = notificationPrerequisite();
  if (prerequisite) return prerequisite;
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return permission === 'denied' ? 'blocked' : 'disabled';
  }

  const registration = await agentServiceWorkerRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await createAgentPushSubscription(registration));
  await bindAgentSubscription(subscription, agentId, true);
  return 'enabled';
}

export async function disableAgentNotifications(): Promise<AgentNotificationState> {
  if (!supported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration(
    AGENT_SERVICE_WORKER_SCOPE,
  );
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    let removalError: unknown = null;
    try {
      await request('/api/agent/push/subscriptions/remove', {
        method: 'POST',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } catch (error) {
      removalError = error;
    }
    await subscription.unsubscribe();
    clearAgentPushBinding();
    if (removalError) throw removalError;
  }
  clearAgentPushBinding();
  return Notification.permission === 'denied' ? 'blocked' : 'disabled';
}

export function updateAgentAppBadge(unreadMessageCount: number): void {
  const badgeNavigator = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  runBestEffortAgentCapability(() =>
    unreadMessageCount > 0
      ? badgeNavigator.setAppBadge?.(unreadMessageCount)
      : badgeNavigator.clearAppBadge?.(),
  );
  runBestEffortAgentCapability(() => {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'agent.badge.sync',
      unreadMessageCount,
    });
  });
}

function notificationPrerequisite(): AgentNotificationState | null {
  if (!window.isSecureContext) return 'unsupported';
  if (isIosDevice() && !isStandaloneAgentPwa()) return 'install-required';
  return supported() ? null : 'unsupported';
}

function supported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function isIosDevice(): boolean {
  return (
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneAgentPwa(): boolean {
  const standaloneNavigator = navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    standaloneNavigator.standalone === true
  );
}

async function agentServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register('/agent-sw.js', {
    scope: AGENT_SERVICE_WORKER_SCOPE,
  });
  if (registration.active) return registration;

  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('通知服务启动超时，请刷新页面后重试')),
          AGENT_SERVICE_WORKER_READY_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

async function createAgentPushSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription> {
  const config = await request<PushConfig>('/api/agent/push/config');
  if (!config.enabled || !config.applicationServerKey) {
    throw new Error('通知服务尚未就绪');
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlBytes(config.applicationServerKey),
  });
}

async function bindAgentSubscription(
  subscription: PushSubscription,
  agentId: string,
  force = false,
): Promise<void> {
  const marker = `${agentId}\n${subscription.endpoint}`;
  if (!force && readAgentPushBinding() === marker) return;
  await request('/api/agent/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  try {
    window.localStorage.setItem(AGENT_PUSH_BINDING_KEY, marker);
  } catch {
    // The server binding remains valid when private storage is unavailable.
  }
}

function readAgentPushBinding(): string | null {
  try {
    return window.localStorage.getItem(AGENT_PUSH_BINDING_KEY);
  } catch {
    return null;
  }
}

function clearAgentPushBinding(): void {
  try {
    window.localStorage.removeItem(AGENT_PUSH_BINDING_KEY);
  } catch {
    // Nothing else is required after the server subscription is removed.
  }
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/gu, '+')
    .replace(/_/gu, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function request<T = { ok: boolean }>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || '通知设置失败');
  return payload;
}
