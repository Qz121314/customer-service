import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { topLevelDeclaration } from './helpers/source-contract.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const agentPush = read('../src/worker/agent-push.ts');
const visitorPush = read('../src/worker/visitor-push.ts');
const retention = read('../src/worker/conversation-retention.ts');
const mediaStore = read('../src/worker/media-store.ts');

test('agent push keeps expired-subscription cleanup off the message hot path', () => {
  const source = topLevelDeclaration(
    agentPush,
    'export async function sendAgentPushForMessage',
  );

  assert.equal((source.match(/env\.DB\.prepare/gu) ?? []).length, 1);
  assert.doesNotMatch(source, /DELETE FROM agent_push_subscriptions/u);
  assert.match(source, /subscription\.expiration_time > \?2/u);
});

test('visitor push resolves identity, subscription and VAPID in one D1 read', () => {
  const source = topLevelDeclaration(
    visitorPush,
    'export async function sendVisitorPushForConversation',
  );

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

test('visitor media completion never revives an unassigned conversation', () => {
  const source = topLevelDeclaration(
    mediaStore,
    'export async function completeMedia',
  );

  assert.doesNotMatch(source, /assignConversationAgent/u);
  assert.doesNotMatch(source, /RETURNING assigned_agent/u);
  assert.doesNotMatch(source, /conversation\.assigned/u);
  assert.match(source, /assigned_agent IS NOT NULL/u);
  assert.match(source, /SELECT 1 FROM messages WHERE id = \?1/u);
});
