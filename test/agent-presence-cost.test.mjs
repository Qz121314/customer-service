import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('presence stays realtime-only and does not gate automatic routing', async () => {
  const [core, routing, waiting, dashboardApi] = await Promise.all([
    read('../src/worker/core.ts'),
    read('../src/worker/routing.ts'),
    read('../src/worker/waiting-assignment.ts'),
    read('../src/dashboard/api.ts'),
  ]);

  assert.match(
    core,
    /datetime\(last_seen_at\) <= datetime\('now', '-90 seconds'\)/u,
  );
  assert.match(core, /AGENT_PRESENCE_WRITE_INTERVAL_MS = 5 \* 60 \* 1000/u);
  assert.match(core, /presenceWrittenAt/u);
  assert.match(core, /agentPresenceWriteDue/u);
  assert.match(core, /markAgentPresenceWritten/u);
  assert.match(core, /X-CS-Track-Presence/u);
  assert.doesNotMatch(routing, /a\.status = 'online'/u);
  assert.doesNotMatch(routing, /a\.last_seen_at/u);
  assert.doesNotMatch(waiting, /last_seen_at/u);
  assert.match(waiting, /assignConversationAgent/u);
  assert.match(dashboardApi, /window\.setInterval\(ping, 60_000\)/u);
});
