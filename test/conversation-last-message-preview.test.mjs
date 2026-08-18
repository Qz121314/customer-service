import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('conversation preview is backfilled from the latest persisted message', async () => {
  const migration = await read(
    '../migrations/0032_conversation_last_message_preview.sql',
  );

  assert.match(
    migration,
    /ALTER TABLE conversations ADD COLUMN last_message_preview TEXT/u,
  );
  assert.match(migration, /ORDER BY m\.created_at DESC, m\.id DESC/u);
});

test('agent inbox reads cached last-message previews without per-row message lookups', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadAgentInbox');
  const end = worker.indexOf("agentApi.get('/api/agent/stats'", start);
  assert.ok(start >= 0 && end > start);
  const inbox = worker.slice(start, end);

  assert.match(inbox, /c\.last_message_preview AS last_message/u);
  assert.doesNotMatch(inbox, /SELECT body FROM messages/u);
});

test('text and image message writes maintain the cached preview in existing conversation updates', async () => {
  const [agentApi, clientApi, mediaStore] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/client-api.ts'),
    read('../src/worker/media-store.ts'),
  ]);

  assert.match(
    agentApi,
    /last_message_preview = \?2,[\s\S]*\.bind\(now, text, id, agent\.id\)/u,
  );
  assert.match(
    clientApi,
    /last_message_preview = \?2,[\s\S]*\.bind\(createdAt, input\.body, input\.conversationId, id\)/u,
  );
  assert.ok(
    (mediaStore.match(/last_message_preview = '',/gu) ?? []).length >= 2,
    'agent and visitor image writes should clear the text preview',
  );
});

test('client conversation summaries also reuse the cached preview', async () => {
  const clientApi = await read('../src/worker/client-api.ts');

  assert.ok(
    (clientApi.match(/c\.last_message_preview AS last_message/gu) ?? []).length >=
      3,
    'list, owned conversation and realtime summary reads should use the cache',
  );
  assert.doesNotMatch(clientApi, /SELECT body FROM messages m WHERE m\.conversation_id = c\.id/u);
});
