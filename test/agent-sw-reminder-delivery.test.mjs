import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(
  new URL('../public/agent-sw.js', import.meta.url),
  'utf8',
);
const payload = (messageId = 'm1') => ({
  type: 'CUSTOMER_REPLY',
  messageId,
  conversationId: 'c1',
  title: '客户回复',
  body: 'hello',
});
function environment({ fail = false } = {}) {
  const handlers = {},
    shown = [],
    replies = [];
  const self = {
    location: { origin: 'https://cs.test' },
    navigator: {},
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    clients: {
      async matchAll() {
        throw Error('visibility must not gate reminders');
      },
    },
    registration: {
      async showNotification(title, options) {
        if (fail) throw Error('blocked');
        shown.push({ title, ...options });
      },
    },
  };
  vm.runInNewContext(source, { self, URL, setTimeout, clearTimeout });
  return {
    shown,
    replies,
    self,
    setFailure(value) {
      fail = value;
    },
    push(value = payload()) {
      let task;
      handlers.push({
        data: { json: () => value },
        waitUntil(promise) {
          task = promise;
        },
      });
      return task;
    },
    realtime(value = payload(), path = '/agent') {
      let task;
      handlers.message({
        data: { type: 'agent.reminder.deliver', reminder: value },
        source: { url: `https://cs.test${path}` },
        ports: [
          {
            postMessage(value) {
              replies.push(value);
            },
          },
        ],
        waitUntil(promise) {
          task = promise;
        },
      });
      return task;
    },
  };
}

test('Push is always non-silent and requests vibration without inspecting visible windows', async () => {
  const env = environment();
  await env.push();
  await env.push({ ...payload('m2'), type: 'NEW_CONVERSATION' });
  assert.deepEqual(
    env.shown.map((item) => item.silent),
    [false, false],
  );
  assert.deepEqual(Array.from(env.shown[0].vibrate), [220, 100, 220]);
  assert.deepEqual(Array.from(env.shown[1].vibrate), [220, 100, 220, 100, 320]);
  assert.ok(env.shown[0].data.url.includes('conversationId=c1'));
});

test('realtime deduplicates and every Push refreshes the same non-renotifying tag for iOS', async () => {
  const env = environment();
  await Promise.all([env.push(), env.realtime(), env.realtime()]);
  await env.push();
  await env.realtime();
  assert.equal(env.shown.length, 2);
  assert.equal(new Set(env.shown.map((item) => item.tag)).size, 1);
  assert.ok(
    env.shown.every((item) => item.renotify === false && item.silent === false),
  );
  assert.ok(env.replies.every((reply) => reply.delivered === true));
});

test('notification rejection is not marked delivered and can be retried', async () => {
  const env = environment({ fail: true });
  await env.realtime();
  assert.equal(env.replies[0].delivered, false);
  env.setFailure(false);
  await env.push();
  assert.equal(env.shown.length, 1);
});

test('unrelated pages and malformed realtime requests cannot acknowledge delivery', async () => {
  const env = environment();
  await env.realtime(payload(), '/admin');
  await env.realtime(payload(), '/agent-other');
  await env.realtime(payload(''));
  assert.equal(env.shown.length, 0);
  assert.equal(env.replies.length, 0);
});

test('badge errors do not suppress system notification', async () => {
  const env = environment();
  env.self.navigator.setAppBadge = () => {
    throw Error('unsupported');
  };
  await env.push({ ...payload(), conversationUnreadCount: 1 });
  assert.equal(env.shown.length, 1);
});

test('blocked device storage cannot indefinitely delay a new message alert', async () => {
  const env = environment();
  env.self.indexedDB = {
    open() {
      return {};
    },
  };
  await env.push();
  assert.equal(env.shown.length, 1);
  assert.equal(env.shown[0].silent, false);
});
