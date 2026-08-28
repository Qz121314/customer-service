import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('runtime heartbeats avoid DO wakeups while online status gates routing', async () => {
  const [core, agentApi, routing, waiting, dashboardApi] = await Promise.all([
    read('../src/worker/core.ts'),
    read('../src/worker/agent-api.ts'),
    read('../src/worker/routing.ts'),
    read('../src/worker/waiting-assignment.ts'),
    read('../src/dashboard/api.ts'),
  ]);

  const writeWindow =
    /datetime\(last_seen_at\) <= datetime\('now', '-90 seconds'\)/u;
  assert.match(core, writeWindow);
  assert.match(agentApi, writeWindow);
  assert.match(routing, /a\.status = 'online'/u);
  assert.doesNotMatch(routing, /a\.last_seen_at/u);
  assert.doesNotMatch(waiting, /last_seen_at/u);
  assert.match(waiting, /assignConversationAgent/u);
  assert.match(dashboardApi, /window\.setInterval\(ping, 60_000\)/u);
  assert.match(core, /setWebSocketAutoResponse/u);
  assert.match(core, /new WebSocketRequestResponsePair\(/u);
  const messageHandler = core.slice(
    core.indexOf('async webSocketMessage('),
    core.indexOf('private async touchAgent('),
  );
  assert.doesNotMatch(messageHandler, /message === 'ping'/u);
  assert.doesNotMatch(messageHandler, /touchAgent/u);
});
