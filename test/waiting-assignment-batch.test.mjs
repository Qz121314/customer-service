import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('waiting recovery delegates ownership to canonical round robin', async () => {
  const waiting = await read('../src/worker/waiting-assignment.ts');

  assert.match(
    waiting,
    /import \{ assignConversationAgent \} from '\.\/routing'/u,
  );
  assert.match(waiting, /ORDER BY last_message_at ASC, id ASC/u);
  assert.match(waiting, /LIMIT \?1/u);
  assert.match(
    waiting,
    /assignConversationAgent\(env\.DB, row\.id\)/u,
  );
  assert.match(waiting, /assignment\.id/u);
  assert.match(waiting, /MAX_RECOVERY_ASSIGNMENTS = 10/u);

  assert.doesNotMatch(waiting, /a\.status/u);
  assert.doesNotMatch(waiting, /last_seen_at/u);
  assert.doesNotMatch(waiting, /max_active_conversations/u);
  assert.doesNotMatch(waiting, /daily_conversation_limit/u);
  assert.doesNotMatch(waiting, /traffic_quota_used/u);
  assert.ok(
    waiting.includes('_triggerAgentId'),
    'presence may trigger recovery but must not choose the receiving seat',
  );
});
