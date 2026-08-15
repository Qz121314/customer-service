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
    /broadcastRoom\(env, agentInboxRoom\(conversation\.assigned_agent\)/u,
  );
  assert.match(clientApi, /if \(!conversation\.assigned_agent\) return;/u);
  assert.doesNotMatch(agentApi, /room\(c\.env, 'admin-inbox'\)/u);
  assert.doesNotMatch(clientApi, /broadcastRoom\(env, 'admin-inbox'/u);
});

test('disabling an agent releases conversations and revokes realtime access', () => {
  assert.match(
    adminConfigApi,
    /SET assigned_agent = NULL,[\s\S]*assigned_business_date = NULL,[\s\S]*status = 'open'/u,
  );
  assert.match(adminConfigApi, /DELETE FROM agent_sessions/u);
  assert.match(adminConfigApi, /disconnectAgentRealtime/u);
  assert.match(adminConfigApi, /assignConversationAgent/u);
});
