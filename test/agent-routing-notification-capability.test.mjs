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

async function createDatabase() {
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
      daily_conversation_limit INTEGER NOT NULL DEFAULT 0,
      traffic_quota_enabled INTEGER NOT NULL DEFAULT 0,
      traffic_quota_total INTEGER NOT NULL DEFAULT 0,
      traffic_quota_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE agent_routing_scopes (
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT '',
      product_id TEXT NOT NULL DEFAULT '',
      is_enabled INTEGER NOT NULL
    );
    CREATE TABLE product_catalog (
      site_id TEXT NOT NULL,
      id TEXT NOT NULL,
      section_id TEXT,
      category_id TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
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
      cta_affinity_agent_id TEXT,
      cta_affinity_expires_at TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE agent_daily_stats (
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      conversation_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, agent_id, business_date)
    );
    CREATE TABLE agent_traffic_receipts (
      conversation_id TEXT PRIMARY KEY
    );
    CREATE TABLE agent_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      expiration_time INTEGER
    );
  `);
  database.exec(
    await read('../migrations/0042_simple_round_robin_routing.sql'),
  );
  database.exec(await read('../migrations/0048_product_round_robin.sql'));
  database.exec(await read('../migrations/0051_site_global_round_robin.sql'));
  return database;
}

function addAgent(database, id, expirationTime) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled
       ) VALUES (?, 'default', ?, ?, 'hash', 'online', 1)`,
    )
    .run(id, id, id);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, is_enabled
       ) VALUES ('default', ?, 'section', 'west', 1)`,
    )
    .run(id);
  if (expirationTime !== false) {
    database
      .prepare(
        `INSERT INTO agent_push_subscriptions (
           endpoint, agent_id, expiration_time
         ) VALUES (?, ?, ?)`,
      )
      .run(`https://push.example.test/${id}`, id, expirationTime);
  }
}

function addConversation(database, id) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id,
         assigned_agent, status, expires_at, created_at
       ) VALUES (?, 'default', 'product-a', 'west', 'category-a',
         NULL, 'open', '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id);
}

test('new automatic traffic requires a valid agent push subscription', async () => {
  const database = await createDatabase();
  addAgent(database, 'agent-no-push', false);
  addAgent(database, 'agent-expired-push', Date.now() - 60_000);
  addAgent(database, 'agent-reachable', null);
  addConversation(database, 'conversation-1');

  const first = await assignConversationAgent(d1(database), 'conversation-1');
  assert.equal(first?.id, 'agent-reachable');

  database.exec(`DELETE FROM agent_push_subscriptions`);
  addConversation(database, 'conversation-2');
  const second = await assignConversationAgent(d1(database), 'conversation-2');
  assert.equal(second, null);

  database.close();
});
