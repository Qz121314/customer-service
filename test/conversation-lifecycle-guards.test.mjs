import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';

async function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      max_active_conversations INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      assigned_agent TEXT,
      status TEXT NOT NULL,
      agent_unread_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  for (const name of [
    '0036_conversation_lifecycle_guards.sql',
    '0043_remove_manual_transfer_residue.sql',
  ]) {
    database.exec(
      await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
    );
  }
  return database;
}

test('final lifecycle schema removes manual requeue state and trigger', async () => {
  const database = await createDatabase();
  const columns = database.prepare('PRAGMA table_info(conversations)').all();
  const triggers = database
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all();

  assert.equal(
    columns.some((column) => column.name === 'requeue_excluded_agent_id'),
    false,
  );
  assert.equal(
    triggers.some(
      (trigger) => trigger.name === 'trg_conversation_requeue_exclusion',
    ),
    false,
  );
  database.close();
});

test('assignment attention survives removal of manual requeue state', async () => {
  const database = await createDatabase();
  database.exec(`
    INSERT INTO agents (id, site_id, is_enabled)
    VALUES ('agent-a', 'default', 1);
    INSERT INTO conversations (
      id, site_id, assigned_agent, status, agent_unread_count,
      expires_at, created_at
    ) VALUES (
      'conversation-1', 'default', NULL, 'open', 0,
      datetime('now', '+1 day'), CURRENT_TIMESTAMP
    );
    UPDATE conversations
    SET assigned_agent = 'agent-a'
    WHERE id = 'conversation-1';
  `);

  assert.equal(
    database
      .prepare(
        `SELECT agent_unread_count AS unread
         FROM conversations
         WHERE id = 'conversation-1'`,
      )
      .get().unread,
    1,
  );
  database.close();
});
