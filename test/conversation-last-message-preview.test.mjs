import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const migrationPath = '../migrations/0032_conversation_last_message_preview.sql';
const cachedSummary = 'c.last_message_preview AS last_message';

test('backfills latest message preview', async () => {
  const migration = await read(migrationPath);

  assert.ok(migration.includes('ADD COLUMN last_message_preview TEXT'));
  assert.ok(migration.includes('ORDER BY m.created_at DESC, m.id DESC'));
});

test('agent inbox reads cached previews', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadAgentInbox');
  const end = worker.indexOf("agentApi.get('/api/agent/stats'", start);
  assert.ok(start >= 0 && end > start);
  const inbox = worker.slice(start, end);

  assert.ok(inbox.includes(cachedSummary));
  assert.ok(!inbox.includes('SELECT body FROM messages'));
});

test('message writes maintain cached previews', async () => {
  const [agentApi, clientApi, mediaStore] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/client-api.ts'),
    read('../src/worker/media-store.ts'),
  ]);

  assert.ok(agentApi.includes('last_message_preview = ?2,'));
  assert.ok(agentApi.includes('.bind(now, text, id, agent.id)'));
  assert.ok(clientApi.includes('last_message_preview = ?2,'));
  assert.ok(
    clientApi.includes('.bind(createdAt, input.body, input.conversationId, id)'),
  );
  const imagePreviewWrites = mediaStore.match(/last_message_preview = '',/gu);
  assert.ok((imagePreviewWrites ?? []).length >= 2);
});

test('client summaries read cached previews', async () => {
  const clientApi = await read('../src/worker/client-api.ts');
  const summaryReadCount = clientApi.split(cachedSummary).length - 1;

  assert.ok(summaryReadCount >= 3);
  assert.ok(!clientApi.includes('SELECT body FROM messages m'));
});
