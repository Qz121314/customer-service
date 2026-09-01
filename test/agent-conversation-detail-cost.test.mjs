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

test('agent read acknowledgement writes one conversation cursor instead of message rows', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const route = block(
    worker,
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
    "agentApi.post('/api/agent/conversations/:id/messages', async (c) => {",
  );

  assert.doesNotMatch(route, /UPDATE messages/u);
  assert.match(route, /UPDATE conversations/u);
  assert.match(route, /agent_read_through_at = \?2/u);
  assert.match(route, /agent_read_through_id = \?3/u);
  assert.match(route, /read_by_agent_at IS NULL/u);
  assert.match(route, /if \(!conversation\)/u);
});

test('conversation detail cursors use normalized timestamp index semantics', async () => {
  const [worker, attachments, initial, normalization] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/message-attachments.ts'),
    read('../migrations/0001_initial.sql'),
    read('../migrations/0007_message_timestamp_order.sql'),
  ]);
  const detail = block(
    worker,
    "agentApi.get('/api/agent/conversations/:id/messages', async (c) => {",
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
  );
  const attachmentList = block(
    attachments,
    'export async function listConversationAttachments(',
    'export async function loadMessageAttachments(',
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
  assert.match(detail, /OR m\.created_at > \?2/u);
  assert.match(detail, /OR \(m\.created_at = \?2 AND m\.id > \?3\)/u);
  assert.match(detail, /ORDER BY m\.created_at ASC, m\.id ASC/u);
  assert.doesNotMatch(attachmentList, /julianday\(m\.created_at\)/u);
  assert.match(attachmentList, /OR m\.created_at > \?2/u);
  assert.match(
    attachmentList,
    /ORDER BY message_id ASC, sort_order ASC, id ASC/u,
  );
});
