import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { assignConversationAgent } from '../src/worker/routing.ts';

function d1(database) {
  return {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...bindings) ?? null;
        },
        async run() {
          const result = database.prepare(sql).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      password_hash TEXT,
      status TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      max_active_conversations INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      last_assigned_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE agent_products (
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL
    );
    CREATE TABLE support_groups (
      site_id TEXT NOT NULL,
      id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      PRIMARY KEY (site_id, id)
    );
    CREATE TABLE group_agents (
      site_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      product_id TEXT,
      group_id TEXT,
      assigned_agent TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    INSERT INTO support_groups VALUES ('default', 'legacy', 1);
  `);
  return database;
}

function addAgent(database, { id, status = 'online', lastAssignedAt = null }) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         max_active_conversations, last_seen_at, last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, ?)`,
    )
    .run(id, id, id, `hash-${id}`, status, lastAssignedAt);
}

function addConversation(database, id, productId, groupId = 'legacy') {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, group_id, assigned_agent,
         status, expires_at, created_at
       ) VALUES (?, 'default', ?, ?, NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id, productId, groupId);
}

test('agents assigned to the same product receive conversations round-robin', async () => {
  const database = createDatabase();
  addAgent(database, {
    id: 'agent-a',
    lastAssignedAt: '2026-01-01T00:00:00.000Z',
  });
  addAgent(database, { id: 'agent-b' });
  database.exec(`
    INSERT INTO agent_products VALUES
      ('default', 'agent-a', 'product-a', 1),
      ('default', 'agent-b', 'product-a', 1);
  `);
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-a');

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');

  assert.equal(first?.id, 'agent-b');
  assert.equal(second?.id, 'agent-a');
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get('conversation-1').assigned_agent,
    'agent-b',
  );
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get('conversation-2').assigned_agent,
    'agent-a',
  );
  database.close();
});

test('configured product never falls back to a legacy group when its agent is unavailable', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'product-agent', status: 'offline' });
  addAgent(database, { id: 'legacy-agent' });
  database.exec(`
    INSERT INTO agent_products VALUES
      ('default', 'product-agent', 'product-a', 1);
    INSERT INTO group_agents VALUES
      ('default', 'legacy', 'legacy-agent', 1);
  `);
  addConversation(database, 'conversation-1', 'product-a');

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment, null);
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get('conversation-1').assigned_agent,
    null,
  );
  database.close();
});

test('legacy group is used only for products without product-agent assignments', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'legacy-agent' });
  database.exec(`
    INSERT INTO group_agents VALUES
      ('default', 'legacy', 'legacy-agent', 1);
  `);
  addConversation(database, 'conversation-1', 'product-without-mapping');

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment?.id, 'legacy-agent');
  database.close();
});
