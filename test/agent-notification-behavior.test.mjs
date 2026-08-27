import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enableAgentNotifications,
  prepareAgentNotifications,
} from '../src/dashboard/agent-push.ts';

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function browserEnvironment({ ios = false, standalone = false } = {}) {
  const storage = new Map();
  const subscription = {
    endpoint: 'https://push.example.test/subscription',
    toJSON() {
      return { endpoint: this.endpoint, expirationTime: null };
    },
    async unsubscribe() {
      return true;
    },
  };
  const pushManager = {
    async getSubscription() {
      return subscription;
    },
    async subscribe() {
      return subscription;
    },
  };
  const registration = { active: {}, pushManager };
  const notification = {
    permission: 'granted',
    async requestPermission() {
      return 'granted';
    },
  };
  const windowValue = {
    isSecureContext: true,
    Notification: notification,
    PushManager: class PushManager {},
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      },
      removeItem(key) {
        storage.delete(key);
      },
    },
    matchMedia() {
      return { matches: standalone };
    },
  };
  const navigatorValue = {
    userAgent: ios ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)' : 'Chrome',
    platform: ios ? 'iPhone' : 'Linux armv8l',
    maxTouchPoints: ios ? 5 : 1,
    standalone,
    serviceWorker: {
      ready: Promise.resolve(registration),
      async register() {
        return registration;
      },
    },
  };
  return { navigatorValue, notification, subscription, windowValue };
}

test('an existing mobile push subscription is rebound to the current agent once', async () => {
  const environment = browserEnvironment();
  const requests = [];
  const restore = [
    replaceGlobal('window', environment.windowValue),
    replaceGlobal('navigator', environment.navigatorValue),
    replaceGlobal('Notification', environment.notification),
    replaceGlobal('fetch', async (path, init) => {
      requests.push({ path, init });
      if (path === '/api/agent/push/config') {
        return Response.json({
          enabled: true,
          applicationServerKey:
            'BEl6XoKJ9jFQ8PVv7n5vJQHw0ThmMZL2lqf0mvtRlVhpyQ',
        });
      }
      return Response.json({ ok: true });
    }),
  ];

  try {
    assert.equal(await prepareAgentNotifications('agent-a'), 'enabled');
    assert.equal(await prepareAgentNotifications('agent-a'), 'enabled');
    assert.equal(await prepareAgentNotifications('agent-b'), 'enabled');
    assert.deepEqual(
      requests.map((request) => request.path),
      ['/api/agent/push/subscriptions', '/api/agent/push/subscriptions'],
    );
    assert.equal(await enableAgentNotifications('agent-b'), 'enabled');
    assert.equal(
      requests.filter(
        (request) => request.path === '/api/agent/push/subscriptions',
      ).length,
      3,
    );
  } finally {
    for (const restoreGlobal of restore.reverse()) restoreGlobal();
  }
});

test('iOS browser tabs ask for Home Screen installation before notification permission', async () => {
  const environment = browserEnvironment({ ios: true, standalone: false });
  let registrationAttempts = 0;
  environment.navigatorValue.serviceWorker.register = async () => {
    registrationAttempts += 1;
    throw new Error('must not register before installation');
  };
  const restore = [
    replaceGlobal('window', environment.windowValue),
    replaceGlobal('navigator', environment.navigatorValue),
    replaceGlobal('Notification', environment.notification),
  ];

  try {
    assert.equal(
      await prepareAgentNotifications('agent-ios'),
      'install-required',
    );
    assert.equal(registrationAttempts, 0);
  } finally {
    for (const restoreGlobal of restore.reverse()) restoreGlobal();
  }
});
