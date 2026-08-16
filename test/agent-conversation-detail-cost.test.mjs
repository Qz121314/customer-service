import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

function block(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('already-read detail loads skip the separate read request', async () => {
  const portal = await read('../src/dashboard/AgentPortal.tsx');
  const load = block(
    portal,
    'const load = (incremental = false) => {',
    'const connect = () => {',
  );

  assert.match(
    load,
    /Number\(value\.conversation\.agent_unread_count \?\? 0\) > 0/u,
  );
  assert.match(
    load,
    /acknowledgeConversation\(\s*selectedId,\s*lastVisitorMessageId/u,
  );
});

test('agent read acknowledgement avoids a duplicate conversation ownership read', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const route = block(
    worker,
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
    "agentApi.post('/api/agent/conversations/:id/messages', async (c) => {",
  );

  assert.doesNotMatch(
    route,
    /const conversation = await assignedConversation/u,
  );
  assert.match(route, /JOIN conversations c ON c\.id = m\.conversation_id/u);
  assert.match(route, /AND c\.assigned_agent = \?3/u);
  assert.match(
    route,
    /AND EXISTS \([\s\S]*FROM conversations c[\s\S]*c\.assigned_agent = \?4/u,
  );
  assert.match(
    route,
    /const \[readResult, conversationResult\] = await c\.env\.DB\.batch/u,
  );
  assert.match(route, /if \(!conversationResult\.meta\.changes\)/u);
});

test('conversation detail cursors use normalized timestamp index semantics', async () => {
  const [worker, media, initial, normalization] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/media-api.ts'),
    read('../migrations/0001_initial.sql'),
    read('../migrations/0007_message_timestamp_order.sql'),
  ]);
  const detail = block(
    worker,
    "agentApi.get('/api/agent/conversations/:id/messages', async (c) => {",
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
  );
  const mediaList = block(
    media,
    'export async function listConversationMedia(',
    'async function authorizedVisitorMedia(',
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
  assert.match(detail, /OR created_at > \?2/u);
  assert.match(detail, /OR \(created_at = \?2 AND id > \?3\)/u);
  assert.match(detail, /ORDER BY created_at ASC, id ASC/u);
  assert.doesNotMatch(mediaList, /julianday\(m\.created_at\)/u);
  assert.match(mediaList, /OR m\.created_at > \?2/u);
  assert.match(mediaList, /ORDER BY m\.created_at ASC, m\.id ASC/u);
});
