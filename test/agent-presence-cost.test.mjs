import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { classMethodDeclaration } from './helpers/source-contract.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('runtime heartbeats avoid Durable Object wakeups', async () => {
  const [core, agentActivity, agentApi, dashboardApi] = await Promise.all([
    read('../src/worker/core.ts'),
    read('../src/worker/agent-activity.ts'),
    read('../src/worker/agent-api.ts'),
    read('../src/dashboard/api.ts'),
  ]);

  const writeWindow =
    /datetime\(last_seen_at\) <= datetime\('now', '-90 seconds'\)/u;
  assert.match(agentActivity, writeWindow);
  assert.match(agentApi, writeWindow);
  assert.match(core, /touchAgentActivity/u);
  assert.match(dashboardApi, /window\.setInterval\(ping, 60_000\)/u);
  assert.match(core, /setWebSocketAutoResponse/u);
  assert.match(core, /new WebSocketRequestResponsePair\(/u);

  const messageHandler = classMethodDeclaration(
    core,
    '  async webSocketMessage(',
  );
  assert.doesNotMatch(messageHandler, /message === 'ping'/u);
  assert.doesNotMatch(messageHandler, /touchAgentActivity/u);
});
