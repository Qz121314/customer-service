import { readFile, writeFile } from 'node:fs/promises';

const files = {
  agent: 'src/worker/agent-api.ts',
  media: 'src/worker/media-api.ts',
  portal: 'src/dashboard/AgentPortal.tsx',
  test: 'test/agent-conversation-detail-cost.test.mjs',
};

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`Missing replacement target: ${label}`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Replacement target is not unique: ${label}`);
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceCount(source, before, after, expected, label) {
  const parts = source.split(before);
  const count = parts.length - 1;
  if (count !== expected) {
    throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  }
  return parts.join(after);
}

function sliceBlock(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error(`Missing block: ${label}`);
  return { start, end, block: source.slice(start, end) };
}

let portal = await readFile(files.portal, 'utf8');
portal = replaceOnce(
  portal,
  "            if (document.visibilityState === 'visible') {\n              const lastVisitorMessageId =",
  "            if (\n              document.visibilityState === 'visible' &&\n              Number(value.conversation.agent_unread_count ?? 0) > 0\n            ) {\n              const lastVisitorMessageId =",
  'skip read acknowledgement for already-read detail loads',
);
await writeFile(files.portal, portal);

let agent = await readFile(files.agent, 'utf8');
const detail = sliceBlock(
  agent,
  "agentApi.get('/api/agent/conversations/:id/messages', async (c) => {",
  "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
  'conversation detail route',
);
let detailBlock = detail.block;
detailBlock = replaceCount(
  detailBlock,
  'ORDER BY julianday(created_at) ASC, id ASC',
  'ORDER BY created_at ASC, id ASC',
  2,
  'detail timestamp ordering',
);
detailBlock = replaceOnce(
  detailBlock,
  'OR julianday(created_at) > julianday(?2)',
  'OR created_at > ?2',
  'detail cursor greater-than comparison',
);
detailBlock = replaceOnce(
  detailBlock,
  'OR (julianday(created_at) = julianday(?2) AND id > ?3)',
  'OR (created_at = ?2 AND id > ?3)',
  'detail cursor tie-break comparison',
);
agent = agent.slice(0, detail.start) + detailBlock + agent.slice(detail.end);

const readRoute = sliceBlock(
  agent,
  "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
  "agentApi.post('/api/agent/conversations/:id/messages', async (c) => {",
  'conversation read route',
);
let readBlock = readRoute.block;
readBlock = replaceOnce(
  readBlock,
  "  const id = c.req.param('id');\n  const conversation = await assignedConversation(c.env.DB, id, agent.id);\n  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);\n\n  const body =",
  "  const id = c.req.param('id');\n  const body =",
  'remove duplicate assigned conversation lookup',
);
readBlock = replaceOnce(
  readBlock,
  "      `SELECT id, created_at\n       FROM messages\n       WHERE id = ?1 AND conversation_id = ?2 AND sender_type = 'visitor'\n       LIMIT 1`,\n    )\n      .bind(requestedLastMessageId, id)\n      .first<ReadBoundary>();",
  "      `SELECT m.id, m.created_at\n       FROM messages m\n       JOIN conversations c ON c.id = m.conversation_id\n       WHERE m.id = ?1 AND m.conversation_id = ?2\n         AND m.sender_type = 'visitor'\n         AND c.assigned_agent = ?3\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,\n    )\n      .bind(requestedLastMessageId, id, agent.id)\n      .first<ReadBoundary>();",
  'authorize read boundary lookup',
);
readBlock = replaceOnce(
  readBlock,
  '  const [readResult] = await c.env.DB.batch([',
  '  const [readResult, conversationResult] = await c.env.DB.batch([',
  'capture conversation update result',
);
readBlock = replaceOnce(
  readBlock,
  "       WHERE conversation_id = ?1\n         AND sender_type = 'visitor'\n         AND (\n           ?2 IS NULL",
  "       WHERE conversation_id = ?1\n         AND sender_type = 'visitor'\n         AND EXISTS (\n           SELECT 1\n           FROM conversations c\n           WHERE c.id = ?1 AND c.assigned_agent = ?4\n             AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n         )\n         AND (\n           ?2 IS NULL",
  'authorize message read update',
);
readBlock = replaceOnce(
  readBlock,
  '    ).bind(id, boundary?.id ?? null, boundary?.created_at ?? null),',
  '    ).bind(id, boundary?.id ?? null, boundary?.created_at ?? null, agent.id),',
  'bind read update ownership',
);
readBlock = replaceOnce(
  readBlock,
  "       WHERE id = ?1 AND assigned_agent = ?2`,",
  "       WHERE id = ?1 AND assigned_agent = ?2\n         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,",
  'preserve expiry authorization on conversation update',
);
readBlock = replaceOnce(
  readBlock,
  "  ]);\n\n  if (readResult.meta.changes) {",
  "  ]);\n\n  if (!conversationResult.meta.changes) {\n    return c.json({ error: 'NOT_FOUND' }, 404);\n  }\n\n  if (readResult.meta.changes) {",
  'return not found when ownership update misses',
);
agent =
  agent.slice(0, readRoute.start) + readBlock + agent.slice(readRoute.end);
await writeFile(files.agent, agent);

let media = await readFile(files.media, 'utf8');
const mediaList = sliceBlock(
  media,
  'export async function listConversationMedia(',
  'async function authorizedVisitorMedia(',
  'conversation media list',
);
let mediaBlock = mediaList.block;
mediaBlock = replaceOnce(
  mediaBlock,
  'OR julianday(m.created_at) > julianday(?2)',
  'OR m.created_at > ?2',
  'media cursor greater-than comparison',
);
mediaBlock = replaceOnce(
  mediaBlock,
  'OR (julianday(m.created_at) = julianday(?2) AND m.id > ?3)',
  'OR (m.created_at = ?2 AND m.id > ?3)',
  'media cursor tie-break comparison',
);
mediaBlock = replaceOnce(
  mediaBlock,
  'ORDER BY julianday(m.created_at) ASC, m.id ASC',
  'ORDER BY m.created_at ASC, m.id ASC',
  'media timestamp ordering',
);
media = media.slice(0, mediaList.start) + mediaBlock + media.slice(mediaList.end);
await writeFile(files.media, media);

const testSource = `import assert from 'node:assert/strict';
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

  assert.match(load, /Number\\(value\\.conversation\\.agent_unread_count \\?\\? 0\\) > 0/u);
  assert.match(load, /acknowledgeConversation\\(\\s*selectedId,\\s*lastVisitorMessageId/u);
});

test('agent read acknowledgement avoids a duplicate conversation ownership read', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const route = block(
    worker,
    "agentApi.post('/api/agent/conversations/:id/read', async (c) => {",
    "agentApi.post('/api/agent/conversations/:id/messages', async (c) => {",
  );

  assert.doesNotMatch(route, /const conversation = await assignedConversation/u);
  assert.match(route, /JOIN conversations c ON c\\.id = m\\.conversation_id/u);
  assert.match(route, /AND c\\.assigned_agent = \\?3/u);
  assert.match(route, /AND EXISTS \\([\\s\\S]*FROM conversations c[\\s\\S]*c\\.assigned_agent = \\?4/u);
  assert.match(route, /const \\[readResult, conversationResult\\] = await c\\.env\\.DB\\.batch/u);
  assert.match(route, /if \\(!conversationResult\\.meta\\.changes\\)/u);
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

  assert.match(initial, /idx_messages_conversation_created[\\s\\S]*messages\\(conversation_id, created_at ASC\\)/u);
  assert.match(normalization, /UPDATE messages[\\s\\S]*strftime\\('%Y-%m-%dT%H:%M:%fZ', created_at\\)/u);
  assert.match(normalization, /trg_messages_normalize_created_at/u);
  assert.doesNotMatch(detail, /julianday\\(created_at\\)/u);
  assert.match(detail, /OR created_at > \\?2/u);
  assert.match(detail, /OR \\(created_at = \\?2 AND id > \\?3\\)/u);
  assert.match(detail, /ORDER BY created_at ASC, id ASC/u);
  assert.doesNotMatch(mediaList, /julianday\\(m\\.created_at\\)/u);
  assert.match(mediaList, /OR m\\.created_at > \\?2/u);
  assert.match(mediaList, /ORDER BY m\\.created_at ASC, m\\.id ASC/u);
});
`;
await writeFile(files.test, testSource);
