import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('final routing schema removes stale seat cursors and uses one site cursor', async () => {
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
    CREATE INDEX idx_agents_round_robin_seq
      ON agents(site_id, is_enabled, round_robin_seq, id);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      product_id TEXT,
      assigned_agent TEXT,
      assigned_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TRIGGER trg_agent_round_robin_cursor
    AFTER UPDATE OF assigned_agent ON conversations
    BEGIN
      UPDATE agents SET last_assigned_at = CURRENT_TIMESTAMP
      WHERE id = NEW.assigned_agent;
    END;
  `);

  database.exec(
    await read('../migrations/0045_remove_stale_agent_routing_fields.sql'),
  );
  database.exec(await read('../migrations/0048_product_round_robin.sql'));
  database.exec(await read('../migrations/0051_site_global_round_robin.sql'));

  const columns = database
    .prepare('PRAGMA table_info(agents)')
    .all()
    .map((row) => row.name);
  assert.equal(columns.includes('max_active_conversations'), false);
  assert.equal(columns.includes('last_assigned_at'), false);
  assert.equal(columns.includes('round_robin_seq'), false);

  const tables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  assert.equal(tables.has('routing_round_robin_cursors'), true);

  const cursorColumns = database
    .prepare('PRAGMA table_info(routing_round_robin_cursors)')
    .all()
    .map((row) => row.name);
  assert.deepEqual(cursorColumns, ['site_id', 'last_agent_id', 'updated_at']);

  database.exec(`
    INSERT INTO agents (id, site_id)
    VALUES ('agent-a', 'default'), ('agent-b', 'default');
    INSERT INTO conversations (
      id, site_id, product_id, assigned_agent, assigned_at, created_at, updated_at
    ) VALUES (
      'conversation-1', 'default', 'product-a', NULL, NULL,
      '2026-08-27T09:00:00.000Z', '2026-08-27T09:00:00.000Z'
    );
    UPDATE conversations
    SET assigned_agent = 'agent-a',
        assigned_at = '2026-08-27T10:00:00.000Z',
        updated_at = '2026-08-27T10:00:00.000Z'
    WHERE id = 'conversation-1';
  `);

  const cursor = database
    .prepare(
      `SELECT last_agent_id, updated_at
       FROM routing_round_robin_cursors
       WHERE site_id = 'default'`,
    )
    .get();
  assert.equal(cursor.last_agent_id, 'agent-a');
  assert.equal(cursor.updated_at, '2026-08-27T10:00:00.000Z');
  database.close();
});

test('site-global cursor migration keeps each site latest successful receiver', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      assigned_agent TEXT,
      assigned_at TEXT
    );
    CREATE TABLE routing_round_robin_cursors (
      site_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      last_agent_id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (site_id, product_id)
    );
    INSERT INTO routing_round_robin_cursors (
      site_id, product_id, last_agent_id, updated_at
    ) VALUES
      ('default', 'product-a', 'agent-a', '2026-08-27T10:00:00.000Z'),
      ('default', 'product-b', 'agent-c', '2026-08-27T12:00:00.000Z'),
      ('secondary', 'product-x', 'agent-z', '2026-08-27T11:00:00.000Z');
  `);

  database.exec(await read('../migrations/0051_site_global_round_robin.sql'));

  assert.deepEqual(
    database
      .prepare(
        `SELECT site_id, last_agent_id, updated_at
         FROM routing_round_robin_cursors
         ORDER BY site_id`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        site_id: 'default',
        last_agent_id: 'agent-c',
        updated_at: '2026-08-27T12:00:00.000Z',
      },
      {
        site_id: 'secondary',
        last_agent_id: 'agent-z',
        updated_at: '2026-08-27T11:00:00.000Z',
      },
    ],
  );
  database.close();
});
