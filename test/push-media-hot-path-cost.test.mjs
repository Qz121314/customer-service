import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

const agentPush = read('../src/worker/agent-push.ts');
const visitorPush = read('../src/worker/visitor-push.ts');
const retention = read('../src/worker/conversation-retention.ts');
const mediaStore = read('../src/worker/media-store.ts');

test('agent push keeps expired-subscription cleanup off the message hot path', () => {
  const start = agentPush.indexOf(
    'export async function sendAgentPushForConversation',
  );
  const end = agentPush.indexOf('async function deliverAgentPush');
  const source = agentPush.slice(start, end);

  assert.equal((source.match(/env\.DB\.prepare/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /DELETE FROM agent_push_subscriptions/u);
  assert.match(source, /subscription\.expiration_time > \?2/u);
});

test('visitor push resolves identity, subscription and VAPID in one D1 read', () => {
  const start = visitorPush.indexOf(
    'export async function sendVisitorPushForConversation',
  );
  const end = visitorPush.indexOf('async function deliverVisitorPush');
  const source = visitorPush.slice(start, end);

  assert.equal((source.match(/env\.DB\.prepare/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /DELETE FROM visitor_push_subscriptions/u);
  assert.match(source, /JOIN visitors visitor/u);
  assert.match(source, /JOIN visitor_push_subscriptions subscription/u);
  assert.match(source, /JOIN visitor_push_vapid vapid/u);
  assert.match(source, /subscription\.expiration_time > \?2/u);
});

test('expired push subscriptions are cleaned in one bounded daily cron window', () => {
  assert.match(
    retention,
    /now\.getUTCHours\(\) === 0 && now\.getUTCMinutes\(\) === 0/u,
  );
  assert.match(
    retention,
    /purgeExpiredPushSubscriptions\(env\.DB, now\.getTime\(\)\)/u,
  );
  assert.match(retention, /DELETE FROM visitor_push_subscriptions/u);
  assert.match(retention, /DELETE FROM agent_push_subscriptions/u);
  assert.match(retention, /PUSH_SUBSCRIPTION_DELETE_BATCH_SIZE = 1000/u);
});

test('visitor media completion reuses assignment state from the update batch', () => {
  const start = mediaStore.indexOf('export async function completeMedia');
  const end = mediaStore.indexOf('function completedMedia');
  const source = mediaStore.slice(start, end);

  assert.match(source, /RETURNING assigned_agent/u);
  assert.match(source, /results\[1\]\?\.results\?\.\[0\]/u);
  assert.doesNotMatch(
    source,
    /SELECT assigned_agent FROM conversations WHERE id = \?1/u,
  );
});
