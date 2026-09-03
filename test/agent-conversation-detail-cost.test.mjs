import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { routeRegistration } from './helpers/source-contract.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('already-read detail loads skip the separate read request', async () => {
  const portal = await read('../src/dashboard/AgentPortal.tsx');

  assert.match(
    portal,
    /document\.visibilityState === 'visible' &&\s*Number\(value\.conversation\.agent_unread_count \?\? 0\) > 0[\s\S]{0,600}?acknowledgeConversation\(\s*selectedId,\s*lastVisitorMessageId/u,
  );
});

test('agent read acknowledgement writes one conversation cursor instead of message rows', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const route = routeRegistration(
    worker,
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
  );

  assert.doesNotMatch(route, /UPDATE messages/u);
  assert.match(route, /UPDATE conversations/u);
  assert.match(route, /agent_read_through_at = \?2/u);
  assert.match(route, /agent_read_through_id = \?3/u);
  assert.match(route, /read_by_agent_at IS NULL/u);
  assert.match(route, /if \(!conversation\)/u);
});

test('conversation detail cursors remain index-compatible without binding SQL layout', async () => {
  const [worker, initial, normalization] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../migrations/0001_initial.sql'),
    read('../migrations/0007_message_timestamp_order.sql'),
  ]);
  const detail = routeRegistration(
    worker,
    "agentApi.get('/api/agent/conversations/:id/messages', async (c) => {",
  );

  assert.match(
    initial,
    /idx_messages_conversation_created[\s\S]*messages\(conversation_id, created_at ASC\)/u,
  );
  assert.match(
    normalization,
    /UPDATE messages[\s\S]*strftime\('%Y-%m-%dT%H:%M:%fZ', created_at\)/u,
  );
  assert.match(normalization, /trg_messages_normalize_created_at/u);
  assert.doesNotMatch(detail, /julianday\(created_at\)/u);
  assert.match(detail, /afterCreatedAt/u);
  assert.match(detail, /beforeCreatedAt/u);
});
