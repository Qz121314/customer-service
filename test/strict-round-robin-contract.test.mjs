import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { assignConversationAgent } from '../src/worker/routing.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

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
      };
    },
  };
}

async function routingDatabase(agentIds = ['agent-a', 'agent-b', 'agent-c']) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      traffic_quota_enabled INTEGER NOT NULL DEFAULT 0,
      traffic_quota_total INTEGER NOT NULL DEFAULT 0,
      traffic_quota_used INTEGER NOT NULL DEFAULT 0,
      last_assigned_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE agent_routing_scopes (
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE product_catalog (
      site_id TEXT NOT NULL,
      id TEXT NOT NULL,
      section_id TEXT,
      category_id TEXT,
      PRIMARY KEY (site_id, id)
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      product_id TEXT,
      section_id TEXT,
      category_id TEXT,
      assigned_agent TEXT,
      assigned_at TEXT,
      assigned_business_date TEXT,
      requeue_excluded_agent_id TEXT,
      cta_affinity_agent_id TEXT,
      cta_affinity_expires_at TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE agent_traffic_receipts (
      conversation_id TEXT PRIMARY KEY
    );
  `);

  const insertAgent = database.prepare(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, status, is_enabled
    ) VALUES (?, 'default', ?, ?, 'hash', 'offline', 1)
  `);
  const insertScope = database.prepare(`
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', ?, 'section', 'west', '', '', 1)
  `);

  for (const id of agentIds) {
    insertAgent.run(id, id, id);
    insertScope.run(id);
  }

  database.exec(
    await read('../migrations/0042_simple_round_robin_routing.sql'),
  );
  return database;
}

function addConversation(database, id) {
  database
    .prepare(`
      INSERT INTO conversations (
        id, site_id, product_id, section_id, category_id,
        assigned_agent, status, expires_at, created_at
      ) VALUES (
        ?, 'default', ?, 'west', 'default', NULL, 'open',
        '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP
      )
    `)
    .run(id, `product-${id}`);
}

test('strict round robin assigns agents in deterministic rotation order', async () => {
  const database = await routingDatabase();
  const db = d1(database);
  const assigned = [];

  for (let index = 1; index <= 4; index += 1) {
    const id = `conversation-${index}`;
    addConversation(database, id);
    assigned.push((await assignConversationAgent(db, id))?.id ?? null);
  }

  assert.deepEqual(assigned, ['agent-a', 'agent-b', 'agent-c', 'agent-a']);
  database.close();
});

test('disabled agents are skipped without breaking the rotation', async () => {
  const database = await routingDatabase();
  database
    .prepare(`UPDATE agents SET is_enabled = 0 WHERE id = 'agent-b'`)
    .run();
  const db = d1(database);
  const assigned = [];

  for (let index = 1; index <= 3; index += 1) {
    const id = `conversation-${index}`;
    addConversation(database, id);
    assigned.push((await assignConversationAgent(db, id))?.id ?? null);
  }

  assert.deepEqual(assigned, ['agent-a', 'agent-c', 'agent-a']);
  database.close();
});

test('routing returns null when no eligible agent exists', async () => {
  const database = await routingDatabase(['agent-a']);
  database.prepare(`UPDATE agents SET is_enabled = 0`).run();
  addConversation(database, 'conversation-1');

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment, null);
  database.close();
});
