import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const agentApi = readFileSync(
  fileURLToPath(new URL('../src/worker/agent-api.ts', import.meta.url)),
  'utf8',
);
const clientApi = readFileSync(
  fileURLToPath(new URL('../src/worker/client-api.ts', import.meta.url)),
  'utf8',
);
const adminConfigApi = readFileSync(
  fileURLToPath(new URL('../src/worker/admin-config-api.ts', import.meta.url)),
  'utf8',
);

test('agent inbox realtime events are isolated by authenticated agent id', () => {
  assert.match(agentApi, /room\(c\.env, agentInboxRoom\(agent\.id\)\)/u);
  assert.match(
    clientApi,
    /broadcastRoomSafely\(env, agentInboxRoom\(conversation\.assigned_agent\)/u,
  );
  assert.match(
    clientApi,
    /broadcastRoomSafely\(env, agentInboxRoom\(previousAgentId\)/u,
  );
  assert.doesNotMatch(agentApi, /room\(c\.env, 'admin-inbox'\)/u);
  assert.doesNotMatch(clientApi, /broadcastRoom\(env, 'admin-inbox'/u);
});

test('disabling an agent preserves current sessions and conversation ownership', () => {
  const editStart = adminConfigApi.indexOf(
    "adminConfigApi.patch('/api/admin/agents/:id'",
  );
  const deleteStart = adminConfigApi.indexOf(
    "adminConfigApi.delete('/api/admin/agents/:id'",
  );
  assert.ok(editStart >= 0 && deleteStart > editStart);
  const editAgent = adminConfigApi.slice(editStart, deleteStart);

  assert.match(editAgent, /is_enabled = \?6/u);
  assert.doesNotMatch(editAgent, /DELETE FROM agent_sessions/u);
  assert.doesNotMatch(editAgent, /SET assigned_agent = NULL/u);
  assert.doesNotMatch(editAgent, /disconnectAgentRealtime/u);
});
