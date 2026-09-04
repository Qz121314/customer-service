/* global self, URL, caches, fetch */

const AGENT_WORKSPACE_URL = '/agent';
const AGENT_SHELL_URL = '/index.html';
const AGENT_NOTIFICATION_URL = '/agent?notification=latest-unread';
const AGENT_CACHE = 'agent-workspace-v5';
const conversationUnread = new Map();
let badgeTotal = 0;
const APP_SHELL = [
  AGENT_SHELL_URL,
  '/agent.webmanifest',
  '/icons/customer-service-192.svg',
  '/icons/customer-service-512.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(AGENT_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('agent-workspace-') && key !== AGENT_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    if (!url.pathname.startsWith('/agent')) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            void caches
              .open(AGENT_CACHE)
              .then((cache) => cache.put(AGENT_SHELL_URL, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(AGENT_SHELL_URL)),
    );
    return;
  }

  if (
    url.pathname === '/agent.webmanifest' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request)
          .then((response) => {
            if (response.ok) {
              void caches
                .open(AGENT_CACHE)
                .then((cache) => cache.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const payload = pushPayload(event);
        const targetUrl = notificationUrl(payload);
        const foreground = clients.some(
          (client) => client.visibilityState === 'visible',
        );
        updateBadgeFromPush(payload);
        return self.registration.showNotification(payload.title, {
          body: payload.body,
          icon: '/icons/customer-service-192.svg',
          badge: '/icons/customer-service-192.svg',
          tag: `agent-message-${payload.messageId}`,
          silent: foreground,
          renotify: false,
          vibrate:
            foreground || payload.type !== 'NEW_CONVERSATION'
              ? foreground
                ? undefined
                : [220, 100, 220]
              : [220, 100, 220, 100, 320],
          data: {
            url: targetUrl,
            conversationId: payload.conversationId,
            messageId: payload.messageId,
          },
        });
      }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'agent.badge.sync') return;
  badgeTotal = Math.max(0, Number(event.data.unreadMessageCount) || 0);
  updateAppBadge(badgeTotal);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || AGENT_NOTIFICATION_URL,
    self.location.origin,
  ).toString();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        const existingAgent = clients.find((client) => {
          const clientUrl = new URL(client.url);
          return (
            clientUrl.origin === self.location.origin &&
            clientUrl.pathname.startsWith(AGENT_WORKSPACE_URL)
          );
        });
        if (existingAgent) {
          existingAgent.postMessage({
            type: 'agent.notification.open',
            target: event.notification.data?.conversationId
              ? 'conversation'
              : 'latest-unread',
            conversationId: event.notification.data?.conversationId || null,
            messageId: event.notification.data?.messageId || null,
          });
          await existingAgent.focus();
          return;
        }
        await self.clients.openWindow(targetUrl);
      }),
  );
});

function pushPayload(event) {
  try {
    const value = event.data?.json();
    if (
      value &&
      (value.type === 'NEW_CONVERSATION' || value.type === 'CUSTOMER_REPLY') &&
      typeof value.conversationId === 'string' &&
      typeof value.messageId === 'string'
    ) {
      return {
        ...value,
        title:
          typeof value.title === 'string' ? value.title : '客服坐席有新消息',
        body:
          typeof value.body === 'string'
            ? value.body
            : '有新的访客消息等待处理',
      };
    }
  } catch {
    // Existing data-less subscriptions fall back until the device rebinds.
  }
  return {
    type: 'CUSTOMER_REPLY',
    conversationId: '',
    messageId: `legacy-${Date.now()}`,
    title: '客服坐席有新消息',
    body: '有新的访客消息等待处理',
    conversationUnreadCount: 1,
  };
}

function notificationUrl(payload) {
  if (!payload.conversationId) return AGENT_NOTIFICATION_URL;
  const url = new URL(AGENT_WORKSPACE_URL, self.location.origin);
  url.searchParams.set('notification', 'message');
  url.searchParams.set('conversationId', payload.conversationId);
  url.searchParams.set('messageId', payload.messageId);
  return `${url.pathname}${url.search}`;
}

function updateBadgeFromPush(payload) {
  if (!payload.conversationId) return;
  const next = Math.max(0, Number(payload.conversationUnreadCount) || 0);
  const previous =
    conversationUnread.get(payload.conversationId) ?? Math.max(0, next - 1);
  conversationUnread.set(payload.conversationId, next);
  badgeTotal = Math.max(0, badgeTotal + next - previous);
  updateAppBadge(badgeTotal);
}

function updateAppBadge(count) {
  const task =
    count > 0
      ? self.navigator.setAppBadge?.(count)
      : self.navigator.clearAppBadge?.();
  void task?.catch(() => undefined);
}
