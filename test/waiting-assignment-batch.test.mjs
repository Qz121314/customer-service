import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('waiting recovery delegates discovery and ownership to canonical routing', async () => {
  const waiting = await read('../src/worker/waiting-assignment.ts');

  assert.match(waiting, /findRoutableWaitingConversationIds/u);
  assert.match(
    waiting,
    /findRoutableWaitingConversationIds\(env\.DB, limit\)/u,
  );
  assert.match(waiting, /assignConversationAgent\(env\.DB, conversationId\)/u);
  assert.match(waiting, /assignment\.id/u);
  assert.match(waiting, /MAX_RECOVERY_ASSIGNMENTS = 10/u);
  assert.ok(
    waiting.includes('_triggerAgentId'),
    'presence may trigger recovery but must not choose the receiving seat',
  );

  assert.doesNotMatch(waiting, /FROM conversations/u);
  assert.doesNotMatch(waiting, /a\.status/u);
  assert.doesNotMatch(waiting, /last_seen_at/u);
  assert.doesNotMatch(waiting, /daily_conversation_limit/u);
  assert.doesNotMatch(waiting, /traffic_quota_used/u);
});
