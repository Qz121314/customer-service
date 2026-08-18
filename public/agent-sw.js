/* global self, URL, caches, fetch */

const AGENT_WORKSPACE_URL = '/agent';
const AGENT_NOTIFICATION_URL = '/agent?notification=latest-unread';
const AGENT_CACHE = 'agent-workspace-v2';
const APP_SHELL = [
  AGENT_WORKSPACE_URL,
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
              .then((cache) =>
                cache.put(AGENT_WORKSPACE_URL, response.clone()),
              );
          }
          return response;
        })
        .catch(() => caches.match(AGENT_WORKSPACE_URL)),
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
        if (clients.some((client) => client.visibilityState === 'visible')) {
          return undefined;
        }
        return self.registration.showNotification('客服坐席有新消息', {
          body: '有新的访客消息等待处理',
          icon: '/icons/customer-service-192.svg',
          badge: '/icons/customer-service-192.svg',
          tag: 'agent-new-message',
          renotify: true,
          data: { url: AGENT_NOTIFICATION_URL },
        });
      }),
  );
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
            target: 'latest-unread',
          });
          await existingAgent.focus();
          return;
        }
        await self.clients.openWindow(targetUrl);
      }),
  );
});
