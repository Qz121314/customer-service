import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent active conversation reads use a dedicated partial index', () => {
  const migration = source(
    '../migrations/0028_conversation_agent_status_index.sql',
  );

  assert.match(migration, /idx_conversations_agent_status/u);
  assert.match(migration, /assigned_agent, status/u);
  assert.match(migration, /WHERE assigned_agent IS NOT NULL/u);
});

test('transfer target load counts only candidate agents', () => {
  const worker = source('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadTransferTargets');
  const end = worker.indexOf('async function loadQuickReplies', start);
  assert.ok(start >= 0 && end > start);
  const section = worker.slice(start, end);

  assert.match(section, /LEFT JOIN conversations load/u);
  assert.match(section, /load\.assigned_agent = a\.id/u);
  assert.match(section, /COUNT\(load\.id\) AS active_count/u);
  assert.doesNotMatch(
    section,
    /SELECT assigned_agent, COUNT\(\*\) AS active_count[\s\S]*GROUP BY assigned_agent/u,
  );
});

test('direct transfer capacity checks only the requested target agent', () => {
  const worker = source('../src/worker/agent-api.ts');
  const start = worker.indexOf(
    "agentApi.post('/api/agent/conversations/:id/transfer'",
  );
  const end = worker.indexOf("agentApi.get('/api/agent/realtime/inbox'", start);
  assert.ok(start >= 0 && end > start);
  const section = worker.slice(start, end);

  assert.match(
    section,
    /SELECT COUNT\(\*\)[\s\S]*FROM conversations load[\s\S]*load\.assigned_agent = target\.id/u,
  );
  assert.doesNotMatch(
    section,
    /SELECT assigned_agent, COUNT\(\*\) AS active_count[\s\S]*GROUP BY assigned_agent/u,
  );
});
