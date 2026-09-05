/* global self, URL, caches, fetch, setTimeout, clearTimeout */

const AGENT_WORKSPACE_URL = '/agent';
const AGENT_SHELL_URL = '/index.html';
const AGENT_NOTIFICATION_URL = '/agent?notification=latest-unread';
const AGENT_CACHE = 'agent-workspace-v6';
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
  const payload = pushPayload(event);
  // Badge failures must not prevent audible notification delivery.
  try {
    updateBadgeFromPush(payload);
  } catch {
    /* Optional OS capability. */
  }
  event.waitUntil(deliverNotification(payload, true));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'agent.reminder.deliver') {
    const payload = event.data.reminder;
    const sourceUrl = event.source?.url && new URL(event.source.url);
    if (
      !sourceUrl ||
      sourceUrl.origin !== self.location.origin ||
      !(
        sourceUrl.pathname === '/agent' ||
        sourceUrl.pathname.startsWith('/agent/')
      ) ||
      !validReminder(payload)
    )
      return;
    event.waitUntil(
      deliverNotification({
        ...payload,
        title: payload.type === 'NEW_CONVERSATION' ? '新客户咨询' : '客户回复',
        body: '有新的客户消息等待处理',
      }).then(
        () => event.ports[0]?.postMessage({ delivered: true }),
        () => event.ports[0]?.postMessage({ delivered: false }),
      ),
    );
    return;
  }
  if (event.data?.type !== 'agent.badge.sync') return;
  conversationUnread.clear();
  badgeTotal = Math.max(0, Number(event.data.unreadMessageCount) || 0);
  updateAppBadge(badgeTotal);
});

// Realtime and Push share one device-local delivery owner. Store only successful
// message IDs (no message content); visibility is never a reason to mute.
const deliveredMessages = new Map();
const deliveryTasks = new Map();
let reminderDatabase;
async function optionalReminderStorage(task) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 300);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function openReminderDatabase() {
  if (!self.indexedDB) return Promise.resolve(null);
  if (!reminderDatabase) {
    reminderDatabase = new Promise((resolve) => {
      const request = self.indexedDB.open('agent-reminder-delivery', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('delivered');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    }).catch(() => null);
  }
  return optionalReminderStorage(reminderDatabase);
}

async function wasDelivered(messageId) {
  const timestamp = deliveredMessages.get(messageId);
  if (timestamp && Date.now() - timestamp < 86_400_000) return true;
  try {
    const db = await openReminderDatabase();
    if (!db) return false;
    const stored = await optionalReminderStorage(
      new Promise((resolve, reject) => {
        const request = db
          .transaction('delivered')
          .objectStore('delivered')
          .get(messageId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    );
    return typeof stored === 'number' && Date.now() - stored < 86_400_000;
  } catch {
    return false;
  }
}

async function rememberDelivery(messageId) {
  const now = Date.now();
  deliveredMessages.set(messageId, now);
  if (deliveredMessages.size > 500)
    deliveredMessages.delete(deliveredMessages.keys().next().value);
  try {
    const db = await openReminderDatabase();
    if (!db) return;
    await optionalReminderStorage(
      new Promise((resolve, reject) => {
        const transaction = db.transaction('delivered', 'readwrite');
        const store = transaction.objectStore('delivered');
        store.put(now, messageId);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          if (now - item.value >= 86_400_000) item.delete();
          item.continue();
        };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      }),
    );
  } catch {
    /* In-memory and notification-tag deduplication remain available. */
  }
}

function validReminder(value) {
  return (
    value &&
    (value.type === 'NEW_CONVERSATION' || value.type === 'CUSTOMER_REPLY') &&
    typeof value.messageId === 'string' &&
    value.messageId.length > 0 &&
    typeof value.conversationId === 'string' &&
    value.conversationId.length > 0
  );
}

function deliverNotification(payload, fromPush = false) {
  const existing = deliveryTasks.get(payload.messageId);
  if (existing) {
    if (!fromPush) return existing;
    return existing
      .catch(() => undefined)
      .then(() => deliverNotification(payload, true));
  }
  const task = (async () => {
    // Apple requires showNotification for EVERY push event. Duplicate Push
    // replaces the same tag with renotify:false instead of dropping the event
    // (which can revoke permission). Only duplicate realtime calls may skip it.
    if (!fromPush && (await wasDelivered(payload.messageId))) return;
    await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/customer-service-192.svg',
      badge: '/icons/customer-service-192.svg',
      tag: `agent-message-${payload.messageId}`,
      silent: false,
      renotify: false,
      vibrate:
        payload.type === 'NEW_CONVERSATION'
          ? [220, 100, 220, 100, 320]
          : [220, 100, 220],
      data: {
        url: notificationUrl(payload),
        conversationId: payload.conversationId,
        messageId: payload.messageId,
      },
    });
    await rememberDelivery(payload.messageId);
  })().finally(() => deliveryTasks.delete(payload.messageId));
  deliveryTasks.set(payload.messageId, task);
  return task;
}

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
    if (validReminder(value)) {
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
