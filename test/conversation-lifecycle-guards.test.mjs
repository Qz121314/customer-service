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
  const migration = await readFile(
    new URL(
      '../migrations/0036_conversation_lifecycle_guards.sql',
      import.meta.url,
    ),
    'utf8',
  );
  database.exec(migration);
  return database;
}

test('manual requeue excludes the releasing seat until another seat accepts it', async () => {
  const database = await createDatabase();
  database.exec(`
    INSERT INTO agents (id, site_id, is_enabled) VALUES
      ('agent-a', 'default', 1),
      ('agent-b', 'default', 1);
    INSERT INTO conversations (
      id, site_id, assigned_agent, status, agent_unread_count,
      expires_at, created_at
    ) VALUES (
      'conversation-1', 'default', 'agent-a', 'pending', 0,
      datetime('now', '+1 day'), CURRENT_TIMESTAMP
    );
  `);

  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = NULL
       WHERE id = 'conversation-1'`,
    )
    .run();
  assert.equal(
    database
      .prepare(
        `SELECT requeue_excluded_agent_id AS excluded
         FROM conversations WHERE id = 'conversation-1'`,
      )
      .get().excluded,
    'agent-a',
  );

  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = 'agent-b'
       WHERE id = 'conversation-1'`,
    )
    .run();
  const received = database
    .prepare(
      `SELECT requeue_excluded_agent_id AS excluded,
         agent_unread_count AS unread
       FROM conversations WHERE id = 'conversation-1'`,
    )
    .get();
  assert.equal(received.excluded, null);
  assert.equal(received.unread, 1);

  database.close();
});

test('administrative disable release does not create a manual requeue exclusion', async () => {
  const database = await createDatabase();
  database.exec(`
    INSERT INTO agents (id, site_id, is_enabled)
    VALUES ('agent-a', 'default', 1);
    INSERT INTO conversations (
      id, site_id, assigned_agent, status, expires_at, created_at
    ) VALUES (
      'conversation-1', 'default', 'agent-a', 'pending',
      datetime('now', '+1 day'), CURRENT_TIMESTAMP
    );
    UPDATE agents SET is_enabled = 0 WHERE id = 'agent-a';
  `);

  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = NULL
       WHERE id = 'conversation-1'`,
    )
    .run();
  assert.equal(
    database
      .prepare(
        `SELECT requeue_excluded_agent_id AS excluded
         FROM conversations WHERE id = 'conversation-1'`,
      )
      .get().excluded,
    null,
  );

  database.close();
});

test('closed conversation must reclaim active capacity before reopening', async () => {
  const database = await createDatabase();
  database.exec(`
    INSERT INTO agents (
      id, site_id, is_enabled, max_active_conversations
    ) VALUES ('agent-a', 'default', 1, 1);
    INSERT INTO conversations (
      id, site_id, assigned_agent, status, expires_at, created_at
    ) VALUES
      (
        'active-conversation', 'default', 'agent-a', 'pending',
        datetime('now', '+1 day'), CURRENT_TIMESTAMP
      ),
      (
        'closed-conversation', 'default', 'agent-a', 'closed',
        datetime('now', '+1 day'), CURRENT_TIMESTAMP
      );
  `);

  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE conversations
           SET status = 'pending'
           WHERE id = 'closed-conversation'`,
        )
        .run(),
    /CONVERSATION_REOPEN_CAPACITY/u,
  );
  assert.equal(
    database
      .prepare(
        `SELECT status FROM conversations
         WHERE id = 'closed-conversation'`,
      )
      .get().status,
    'closed',
  );

  database
    .prepare(
      `UPDATE conversations
       SET status = 'closed'
       WHERE id = 'active-conversation'`,
    )
    .run();
  database
    .prepare(
      `UPDATE conversations
       SET status = 'pending'
       WHERE id = 'closed-conversation'`,
    )
    .run();
  assert.equal(
    database
      .prepare(
        `SELECT status FROM conversations
         WHERE id = 'closed-conversation'`,
      )
      .get().status,
    'pending',
  );

  database.close();
});
