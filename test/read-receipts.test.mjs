import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { routeRegistration } from './helpers/source-contract.mjs';

const migration = await readFile(
  new URL('../migrations/0011_read_receipts.sql', import.meta.url),
  'utf8',
);
const cursorMigration = await readFile(
  new URL(
    '../migrations/0046_reduce_free_tier_write_amplification.sql',
    import.meta.url,
  ),
  'utf8',
);

test('read receipt migration adds persistent agent read state', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(migration);

  const columns = db.prepare('PRAGMA table_info(messages)').all();
  assert.equal(
    columns.some((column) => column.name === 'read_by_agent_at'),
    true,
  );

  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, sender_type, created_at, read_by_agent_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'message-1',
    'conversation-1',
    'visitor',
    '2026-08-14T10:00:00.000Z',
    null,
  );

  const row = db
    .prepare('SELECT read_by_agent_at FROM messages WHERE id = ?')
    .get('message-1');
  assert.equal(row.read_by_agent_at, null);

  db.close();
});

test('conversation read cursors replace hot per-message writes and stale indexes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      site_id TEXT NOT NULL,
      group_id TEXT,
      assigned_agent TEXT,
      assigned_business_date TEXT,
      last_message_at TEXT NOT NULL
    );
    CREATE INDEX idx_conversations_status_last_message
      ON conversations(status, last_message_at DESC);
    CREATE INDEX idx_conversations_site_last_message
      ON conversations(site_id, last_message_at DESC);
    CREATE INDEX idx_conversations_group_assignment
      ON conversations(site_id, group_id, status, assigned_agent, last_message_at DESC);
    CREATE INDEX idx_conversations_agent_business_date
      ON conversations(site_id, assigned_agent, assigned_business_date);
    CREATE INDEX idx_conversations_business_date
      ON conversations(site_id, assigned_business_date);
  `);
  db.exec(cursorMigration);

  const columns = db.prepare('PRAGMA table_info(conversations)').all();
  for (const name of [
    'agent_read_through_at',
    'agent_read_through_id',
    'agent_read_at',
    'visitor_read_through_at',
    'visitor_read_through_id',
    'visitor_read_at',
  ]) {
    assert.equal(
      columns.some((column) => column.name === name),
      true,
      name,
    );
  }

  const indexes = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name),
  );
  for (const name of [
    'idx_conversations_status_last_message',
    'idx_conversations_site_last_message',
    'idx_conversations_group_assignment',
    'idx_conversations_agent_business_date',
    'idx_conversations_business_date',
  ]) {
    assert.equal(indexes.has(name), false, name);
  }
  db.close();
});

test('read APIs preserve payload fields while updating only conversation cursors', async () => {
  const [agent, client] = await Promise.all([
    readFile(new URL('../src/worker/agent-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker/client-api.ts', import.meta.url), 'utf8'),
  ]);
  const agentRead = routeRegistration(
    agent,
    "agentApi.post('/api/agent/conversations/:id/read'",
  );
  const visitorRead = routeRegistration(
    client,
    "clientApi.post('/client/v1/conversations/:id/read'",
  );

  assert.doesNotMatch(agentRead, /UPDATE messages/u);
  assert.doesNotMatch(visitorRead, /UPDATE messages/u);
  assert.match(agentRead, /agent_read_through_at/u);
  assert.match(visitorRead, /visitor_read_through_at/u);
  assert.match(agent, /AS read_by_agent_at/u);
  assert.match(client, /AS read_by_visitor_at/u);
});
