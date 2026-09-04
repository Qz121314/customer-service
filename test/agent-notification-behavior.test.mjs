import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  AGENT_SOUND_PRESET_OPTIONS,
  agentReminderVibrationPattern,
  emitAgentMessageTone,
  loadAgentSoundEnabled,
  loadAgentSoundPreset,
  loadAgentVibrationEnabled,
  rememberAgentReminderMessage,
  saveAgentSoundEnabled,
  saveAgentSoundPreset,
  saveAgentVibrationEnabled,
  supportsAgentVibration,
} from '../src/dashboard/dashboard-runtime.ts';
import {
  enableAgentNotifications,
  prepareAgentNotifications,
  runBestEffortAgentCapability,
  updateAgentAppBadge,
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

function browserEnvironment({
  ios = false,
  standalone = false,
  subscribed = true,
} = {}) {
  const storage = new Map();
  const subscription = {
    endpoint: 'https://push.example.test/subscription',
    toJSON() {
      return {
        endpoint: this.endpoint,
        expirationTime: null,
        keys: { p256dh: 'p256dh', auth: 'auth' },
      };
    },
    async unsubscribe() {
      return true;
    },
  };
  let currentSubscription = subscribed ? subscription : null;
  const pushManager = {
    async getSubscription() {
      return currentSubscription;
    },
    async subscribe() {
      currentSubscription = subscription;
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
  return {
    navigatorValue,
    notification,
    pushManager,
    storage,
    subscription,
    windowValue,
  };
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

test('granted notification permission repairs a missing push subscription', async () => {
  const environment = browserEnvironment({ subscribed: false });
  const requests = [];
  let subscribeAttempts = 0;
  const originalSubscribe = environment.pushManager.subscribe.bind(
    environment.pushManager,
  );
  environment.pushManager.subscribe = async (...args) => {
    subscribeAttempts += 1;
    return originalSubscribe(...args);
  };
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
    assert.equal(subscribeAttempts, 1);
    assert.deepEqual(
      requests.map((request) => request.path),
      ['/api/agent/push/config', '/api/agent/push/subscriptions'],
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

test('agent reminder preferences default on and persist per agent on the current device', () => {
  const environment = browserEnvironment();
  const restoreWindow = replaceGlobal('window', environment.windowValue);

  try {
    assert.equal(loadAgentSoundEnabled('agent-a'), true);
    assert.equal(loadAgentVibrationEnabled('agent-a'), true);

    saveAgentSoundEnabled('agent-a', false);
    saveAgentVibrationEnabled('agent-a', false);
    assert.equal(loadAgentSoundEnabled('agent-a'), false);
    assert.equal(loadAgentVibrationEnabled('agent-a'), false);

    assert.equal(loadAgentSoundEnabled('agent-b'), true);
    assert.equal(loadAgentVibrationEnabled('agent-b'), true);

    saveAgentSoundEnabled('agent-a', true);
    saveAgentVibrationEnabled('agent-a', true);
    assert.equal(environment.storage.get('cs-agent-sound:agent-a'), 'on');
    assert.equal(environment.storage.get('cs-agent-vibration:agent-a'), 'on');
  } finally {
    restoreWindow();
  }
});

test('sound preset defaults to strong and persists on the current device', () => {
  const environment = browserEnvironment();
  const restoreWindow = replaceGlobal('window', environment.windowValue);

  try {
    assert.deepEqual(
      AGENT_SOUND_PRESET_OPTIONS.map((option) => option.id),
      ['strong', 'classic', 'crisp', 'triple', 'soft'],
    );
    assert.equal(loadAgentSoundPreset(), 'strong');
    saveAgentSoundPreset('classic');
    assert.equal(loadAgentSoundPreset(), 'classic');
    assert.equal(environment.storage.get('cs-agent-sound-preset'), 'classic');
    environment.storage.set('cs-agent-sound-preset', 'unsupported');
    assert.equal(loadAgentSoundPreset(), 'strong');
  } finally {
    restoreWindow();
  }
});

test('vibration capability is exposed only when the device implements navigator.vibrate', () => {
  assert.equal(supportsAgentVibration({}), false);
  assert.equal(
    supportsAgentVibration({
      vibrate() {
        return true;
      },
    }),
    true,
  );
});

test('each durable customer message alerts once while duplicate realtime delivery is ignored', () => {
  const seen = new Set();

  assert.equal(rememberAgentReminderMessage(seen, 'message-1'), true);
  assert.equal(rememberAgentReminderMessage(seen, 'message-2'), true);
  assert.equal(rememberAgentReminderMessage(seen, 'message-3'), true);
  assert.equal(rememberAgentReminderMessage(seen, 'message-2'), false);
  assert.equal(seen.size, 3);
});

test('new conversation and customer reply use distinct vibration patterns', () => {
  assert.deepEqual(
    agentReminderVibrationPattern('NEW_CONVERSATION'),
    [220, 100, 220, 100, 320],
  );
  assert.deepEqual(
    agentReminderVibrationPattern('CUSTOMER_REPLY'),
    [220, 100, 220],
  );
});

test('strong agent message tone uses maximum in-app gain', () => {
  const gainEvents = [];
  const frequencies = [];
  const context = {
    currentTime: 5,
    destination: {},
    createGain() {
      return {
        gain: {
          setValueAtTime(value, time) {
            gainEvents.push({ type: 'set', value, time });
          },
          exponentialRampToValueAtTime(value, time) {
            gainEvents.push({ type: 'ramp', value, time });
          },
        },
        connect() {},
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime(value, time) {
            frequencies.push({ value, time });
          },
        },
        connect() {},
        start() {},
        stop() {},
      };
    },
  };

  emitAgentMessageTone(context, 'CUSTOMER_REPLY', 'strong');

  assert.deepEqual(gainEvents, [
    { type: 'set', value: 0.0001, time: 5 },
    { type: 'ramp', value: 1, time: 5.012 },
    { type: 'ramp', value: 0.0001, time: 5.34 },
  ]);
  assert.deepEqual(
    frequencies.map((item) => item.value),
    [880, 1175, 1568],
  );
});

test('new conversation and customer reply use distinct foreground tones', () => {
  const frequencies = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime(value) {
            frequencies.push(value);
          },
        },
        connect() {},
        start() {},
        stop() {},
      };
    },
  };

  emitAgentMessageTone(context, 'NEW_CONVERSATION', 'strong');
  const newConversation = frequencies.splice(0);
  emitAgentMessageTone(context, 'CUSTOMER_REPLY', 'strong');

  assert.deepEqual(newConversation, [880, 1175, 1568, 1760]);
  assert.deepEqual(frequencies, [880, 1175, 1568]);
});

test('classic and crisp presets use clearly distinct synthesized signatures', () => {
  const frequencies = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime(value) {
            frequencies.push(value);
          },
        },
        connect() {},
        start() {},
        stop() {},
      };
    },
  };

  emitAgentMessageTone(context, 'CUSTOMER_REPLY', 'classic');
  const classic = frequencies.splice(0);
  emitAgentMessageTone(context, 'CUSTOMER_REPLY', 'crisp');

  assert.deepEqual(classic, [784, 1047]);
  assert.deepEqual(frequencies, [1319, 1760]);
});

test('app badge follows unread message total and clears at zero', () => {
  const badgeCalls = [];
  const messages = [];
  const restoreNavigator = replaceGlobal('navigator', {
    setAppBadge(count) {
      badgeCalls.push(['set', count]);
      return Promise.resolve();
    },
    clearAppBadge() {
      badgeCalls.push(['clear']);
      return Promise.resolve();
    },
    serviceWorker: {
      controller: {
        postMessage(message) {
          messages.push(message);
        },
      },
    },
  });

  try {
    updateAgentAppBadge(5);
    updateAgentAppBadge(2);
    updateAgentAppBadge(0);
    assert.deepEqual(badgeCalls, [['set', 5], ['set', 2], ['clear']]);
    assert.deepEqual(
      messages.map((message) => message.unreadMessageCount),
      [5, 2, 0],
    );
  } finally {
    restoreNavigator();
  }
});

test('browser reminder failures cannot interrupt core realtime state updates', () => {
  let continued = false;
  assert.doesNotThrow(() => {
    runBestEffortAgentCapability(() => {
      throw new Error('sound unavailable');
    });
    runBestEffortAgentCapability(() => {
      throw new Error('vibration unavailable');
    });
    continued = true;
  });
  assert.equal(continued, true);

  const portal = readFileSync(
    new URL('../src/dashboard/AgentPortal.tsx', import.meta.url),
    'utf8',
  );
  const handlerStart = portal.indexOf(
    "payload.type !== 'conversation.changed'",
  );
  const handlerEnd = portal.indexOf(
    "socket.addEventListener('close'",
    handlerStart,
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = portal.slice(handlerStart, handlerEnd);
  assert.ok(
    handler.indexOf('setConversations') < handler.indexOf('alertForReminder'),
  );
  assert.ok(
    handler.indexOf('setOverview') < handler.indexOf('alertForReminder'),
  );
});
