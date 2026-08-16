import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent web push is authenticated, seat-scoped and dispatched after visitor writes', async () => {
  const [api, delivery, entry, migration, dashboard] = await Promise.all([
    read('../src/worker/agent-push-api.ts'),
    read('../src/worker/agent-push.ts'),
    read('../src/worker/entry.ts'),
    read('../migrations/0011_agent_web_push.sql'),
    read('../src/dashboard/agent-push.ts'),
  ]);

  assert.match(api, /requireAgentSession/u);
  assert.match(api, /agent_push_subscriptions/u);
  assert.match(api, /agent_id = \?2/u);
  assert.match(
    delivery,
    /subscription\.agent_id = conversation\.assigned_agent/u,
  );
  assert.match(delivery, /JOIN visitor_push_vapid vapid/u);
  assert.match(delivery, /sendDataLessPush/u);
  assert.match(entry, /sendAgentPushForConversation/u);
  assert.match(entry, /executionCtx\.waitUntil/u);
  assert.match(
    migration,
    /FOREIGN KEY \(agent_id\) REFERENCES agents\(id\) ON DELETE CASCADE/u,
  );
  assert.match(dashboard, /Notification\.requestPermission\(\)/u);
  assert.match(dashboard, /pushManager\.subscribe/u);
});
