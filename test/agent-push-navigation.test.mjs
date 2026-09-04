import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  agentNotificationMessageTarget,
  agentNotificationOpenTarget,
  clearAgentNotificationOpenIntent,
} from '../src/dashboard/agent-push.ts';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function withWindow(url, run) {
  const original = globalThis.window;
  let currentUrl = new URL(url);
  globalThis.window = {
    get location() {
      return currentUrl;
    },
    history: {
      state: null,
      replaceState(_state, _unused, next) {
        currentUrl = new URL(next, currentUrl);
      },
    },
  };
  try {
    return run(() => currentUrl);
  } finally {
    globalThis.window = original;
  }
}

test('notification URL targets the exact conversation and is cleared after use', () => {
  withWindow(
    'https://service.example/agent?notification=message&conversationId=conversation-42&messageId=message-9',
    (currentUrl) => {
      assert.equal(agentNotificationOpenTarget(), 'conversation-42');
      clearAgentNotificationOpenIntent();
      assert.equal(agentNotificationOpenTarget(), null);
      assert.equal(currentUrl().search, '');
    },
  );
});

test('service worker open messages prefer an exact conversation with legacy fallback', () => {
  assert.equal(
    agentNotificationMessageTarget({
      type: 'agent.notification.open',
      target: 'conversation',
      conversationId: 'conversation-7',
      messageId: 'message-3',
    }),
    'conversation-7',
  );
  assert.equal(
    agentNotificationMessageTarget({
      type: 'agent.notification.open',
      target: 'latest-unread',
    }),
    'latest-unread',
  );
  assert.equal(agentNotificationMessageTarget({ type: 'other' }), null);
});

test('service worker focuses an existing agent PWA with exact message identity', () => {
  const serviceWorker = source('../public/agent-sw.js');
  const inbox = source('../src/dashboard/AgentWorkspacePanels.tsx');

  assert.match(serviceWorker, /conversationId: event\.notification\.data/u);
  assert.match(serviceWorker, /messageId: event\.notification\.data/u);
  assert.match(serviceWorker, /await existingAgent\.focus\(\)/u);
  assert.doesNotMatch(serviceWorker, /existingAgent\.navigate\(/u);
  assert.match(inbox, /conversation\.id === notificationOpenPending/u);
  assert.match(inbox, /selectConversation\(target\.id, 'notification'\)/u);
  assert.doesNotMatch(inbox, /heartbeat\(/u);
  assert.doesNotMatch(inbox, /getAgentInbox\(/u);
});

test('authoritative foreground badge sync resets service-worker delta state', () => {
  const serviceWorker = source('../public/agent-sw.js');
  assert.match(
    serviceWorker,
    /event\.data\?\.type !== 'agent\.badge\.sync'[\s\S]{0,120}conversationUnread\.clear\(\)/u,
  );
});
