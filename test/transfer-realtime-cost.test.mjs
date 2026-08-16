import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('transfer sends incremental inbox deltas instead of forcing full refreshes', () => {
  const agent = source('../src/worker/agent-api.ts');
  const client = source('../src/worker/client-api.ts');
  const portal = source('../src/dashboard/AgentPortal.tsx');
  const start = agent.indexOf(
    "agentApi.post('/api/agent/conversations/:id/transfer'",
  );
  const end = agent.indexOf("agentApi.get('/api/agent/realtime/inbox'", start);
  assert.ok(start >= 0 && end > start);
  const transfer = agent.slice(start, end);

  assert.match(transfer, /previousAgentId: agent\.id/u);
  assert.doesNotMatch(transfer, /broadcastAgentInboxRefresh/u);
  assert.match(client, /agentInboxRoom\(previousAgentId\)/u);
  assert.match(client, /type: 'conversation\.changed'/u);
  assert.match(portal, /payload\.type !== 'conversation\.changed'/u);
  assert.match(portal, /if \(!belongsToAgent\) return withoutCurrent/u);
});

test('direct transfer returns the target identity from the assignment write', () => {
  const agent = source('../src/worker/agent-api.ts');
  const start = agent.indexOf(
    "agentApi.post('/api/agent/conversations/:id/transfer'",
  );
  const end = agent.indexOf("agentApi.get('/api/agent/realtime/inbox'", start);
  assert.ok(start >= 0 && end > start);
  const transfer = agent.slice(start, end);

  assert.match(transfer, /assignedConversationForTransfer/u);
  assert.match(transfer, /RETURNING assigned_agent AS id/u);
  assert.match(
    transfer,
    /assignment = \{ id: transfer\.id, name: transfer\.name \}/u,
  );
  assert.doesNotMatch(
    transfer,
    /SELECT id, name FROM agents WHERE id = \?1 LIMIT 1/u,
  );
});
