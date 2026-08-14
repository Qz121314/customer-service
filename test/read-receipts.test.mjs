import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = await readFile(
  new URL('../migrations/0011_read_receipts.sql', import.meta.url),
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
