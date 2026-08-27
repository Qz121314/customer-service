import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('stale agent routing fields are removed without losing the round robin cursor trigger', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      max_active_conversations INTEGER NOT NULL DEFAULT 0,
      last_assigned_at TEXT,
      round_robin_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE INDEX idx_agents_site_availability
      ON agents(site_id, is_enabled, status, last_assigned_at);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      assigned_agent TEXT,
      assigned_at TEXT
    );
    CREATE TRIGGER trg_agent_round_robin_cursor
    AFTER UPDATE OF assigned_agent ON conversations
    BEGIN
      UPDATE agents SET last_assigned_at = CURRENT_TIMESTAMP
      WHERE id = NEW.assigned_agent;
    END;
  `);

  database.exec(await read('../migrations/0045_remove_stale_agent_routing_fields.sql'));

  const columns = database
    .prepare('PRAGMA table_info(agents)')
    .all()
    .map((row) => row.name);
  assert.equal(columns.includes('max_active_conversations'), false);
  assert.equal(columns.includes('last_assigned_at'), false);
  assert.equal(columns.includes('round_robin_seq'), true);

  const indexes = database
    .prepare('PRAGMA index_list(agents)')
    .all()
    .map((row) => row.name);
  assert.equal(indexes.includes('idx_agents_site_availability'), false);

  database.exec(`
    INSERT INTO agents (id, site_id, round_robin_seq)
    VALUES ('agent-a', 'default', 0), ('agent-b', 'default', 7);
    INSERT INTO conversations (id, site_id, assigned_agent, assigned_at)
    VALUES ('conversation-1', 'default', NULL, NULL);
    UPDATE conversations
    SET assigned_agent = 'agent-a', assigned_at = '2026-08-27T10:00:00.000Z'
    WHERE id = 'conversation-1';
  `);

  const updated = database
    .prepare(
      `SELECT round_robin_seq, updated_at
       FROM agents
       WHERE id = 'agent-a'`,
    )
    .get();
  assert.equal(updated.round_robin_seq, 8);
  assert.equal(updated.updated_at, '2026-08-27T10:00:00.000Z');
  database.close();
});
