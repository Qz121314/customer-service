import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('busy seats stay connected without receiving new conversations', async () => {
  const [agentApi, room, routing, dashboardApi, dashboard] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/core.ts'),
    read('../src/worker/routing.ts'),
    read('../src/dashboard/api.ts'),
    read('../src/dashboard/AgentPortal.tsx'),
  ]);

  assert.match(agentApi, /\/api\/agent\/auth\/status/u);
  assert.match(agentApi, /status === 'busy' \? 'busy' : 'online'/u);
  assert.match(
    room,
    /status = CASE WHEN status = 'busy' THEN 'busy' ELSE 'online' END/u,
  );
  assert.match(routing, /a\.status = 'online'/u);
  assert.match(dashboardApi, /setAgentAvailability/u);
  assert.match(dashboard, /在线接待/u);
  assert.match(dashboard, /暂停接待/u);
});

test('agent text replies keep short-lived local drafts and retry idempotently', async () => {
  const [agentApi, dashboardApi, dashboard, runtime] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/dashboard/api.ts'),
    read('../src/dashboard/AgentPortal.tsx'),
    read('../src/dashboard/dashboard-runtime.ts'),
  ]);

  assert.match(agentApi, /INSERT OR IGNORE INTO messages/u);
  assert.match(agentApi, /client_message_id = \?2/u);
  assert.match(dashboardApi, /clientMessageId/u);
  assert.match(runtime, /cs-agent-drafts:/u);
  assert.match(runtime, /AGENT_DRAFT_TTL_MS/u);
  assert.match(dashboard, /crypto\.randomUUID\(\)/u);
  assert.match(dashboard, /发送失败/u);
  assert.match(dashboard, /重新编辑/u);
});
