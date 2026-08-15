/* global self, URL */

const AGENT_WORKSPACE_URL = '/agent';

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
          data: { url: AGENT_WORKSPACE_URL },
        });
      }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(
    event.notification.data?.url || AGENT_WORKSPACE_URL,
    self.location.origin,
  ).toString();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (clients) => {
        const existing = clients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          await existing.focus();
          if ('navigate' in existing) await existing.navigate(targetUrl);
          return;
        }
        await self.clients.openWindow(targetUrl);
      }),
  );
});
