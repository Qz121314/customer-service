export type AgentNotificationState =
  'unsupported' | 'disabled' | 'blocked' | 'enabled';

const AGENT_NOTIFICATION_PARAM = 'notification';
const AGENT_NOTIFICATION_TARGET = 'latest-unread';
const AGENT_NOTIFICATION_MESSAGE_TYPE = 'agent.notification.open';

type PushConfig = {
  enabled: boolean;
  applicationServerKey: string;
};

export function hasAgentNotificationOpenIntent(): boolean {
  return (
    new URLSearchParams(window.location.search).get(
      AGENT_NOTIFICATION_PARAM,
    ) === AGENT_NOTIFICATION_TARGET
  );
}

export function clearAgentNotificationOpenIntent(): void {
  const url = new URL(window.location.href);
  if (
    url.searchParams.get(AGENT_NOTIFICATION_PARAM) !== AGENT_NOTIFICATION_TARGET
  ) {
    return;
  }
  url.searchParams.delete(AGENT_NOTIFICATION_PARAM);
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${url.search}${url.hash}`,
  );
}

export function isAgentNotificationOpenMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === AGENT_NOTIFICATION_MESSAGE_TYPE &&
    record.target === AGENT_NOTIFICATION_TARGET
  );
}

export async function prepareAgentNotifications(): Promise<AgentNotificationState> {
  if (!supported()) return 'unsupported';
  const registration = await navigator.serviceWorker.register('/agent-sw.js', {
    scope: '/',
  });
  if (Notification.permission === 'denied') return 'blocked';
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'enabled' : 'disabled';
}

export async function enableAgentNotifications(): Promise<AgentNotificationState> {
  if (!supported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return permission === 'denied' ? 'blocked' : 'disabled';
  }

  const registration = await navigator.serviceWorker.register('/agent-sw.js', {
    scope: '/',
  });
  const config = await request<PushConfig>('/api/agent/push/config');
  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlBytes(config.applicationServerKey),
  });
  await request('/api/agent/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  return 'enabled';
}

export async function disableAgentNotifications(): Promise<AgentNotificationState> {
  if (!supported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration('/');
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
    if (removalError) throw removalError;
  }
  return Notification.permission === 'denied' ? 'blocked' : 'disabled';
}

function supported(): boolean {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
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
