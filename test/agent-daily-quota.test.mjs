import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';
import {
  assignConversationAgent,
  routingBusinessDate,
} from '../src/worker/routing.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const roundRobinMigration = '../migrations/0042_simple_round_robin_routing.sql';
const dailyLimitMigration =
  '../migrations/0044_daily_reception_limit_guard.sql';
const productRoundRobinMigration =
  '../migrations/0048_product_round_robin.sql';

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

async function createDatabase(agents) {
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
      daily_conversation_limit INTEGER NOT NULL DEFAULT 0,
      traffic_quota_enabled INTEGER NOT NULL DEFAULT 0,
      traffic_quota_total INTEGER NOT NULL DEFAULT 0,
      traffic_quota_used INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
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
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site_id, agent_id, business_date)
    );
    CREATE TABLE agent_traffic_receipts (
      conversation_id TEXT PRIMARY KEY
    );
    CREATE TRIGGER test_daily_stats
    AFTER UPDATE OF assigned_agent ON conversations
    WHEN OLD.assigned_agent IS NULL
      AND NEW.assigned_agent IS NOT NULL
      AND NEW.assigned_business_date IS NOT NULL
    BEGIN
      INSERT INTO agent_daily_stats (
        site_id, agent_id, business_date, conversation_count
      ) VALUES (
        NEW.site_id,
        NEW.assigned_agent,
        NEW.assigned_business_date,
        1
      )
      ON CONFLICT(site_id, agent_id, business_date) DO UPDATE SET
        conversation_count = conversation_count + 1,
        updated_at = CURRENT_TIMESTAMP;
    END;
  `);

  for (const agent of agents) {
    database
      .prepare(
        `INSERT INTO agents (
           id, site_id, name, username, password_hash,
           status, is_enabled, daily_conversation_limit
         ) VALUES (?, 'default', ?, ?, 'hash', 'online', 1, ?)`,
      )
      .run(agent.id, agent.name, agent.id, agent.limit);
    database
      .prepare(
        `INSERT INTO agent_routing_scopes (
           site_id, agent_id, scope_type, section_id,
           category_id, product_id, is_enabled
         ) VALUES ('default', ?, 'section', 'west', '', '', 1)`,
      )
      .run(agent.id);
  }

  database.exec(await read(roundRobinMigration));
  database.exec(await read(dailyLimitMigration));
  database.exec(await read(productRoundRobinMigration));
  return database;
}

function addConversation(database, id) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id,
         status, expires_at, created_at
       ) VALUES (
         ?, 'default', 'product-west', 'west', 'support', 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP
       )`,
    )
    .run(id);
}

async function assign(database, id) {
  const result = await assignConversationAgent(d1(database), id);
  return result?.id ?? null;
}

function count(database, agentId) {
  const row = database
    .prepare(
      `SELECT conversation_count AS count
       FROM agent_daily_stats
       WHERE site_id = 'default'
         AND agent_id = ?
         AND business_date = ?`,
    )
    .get(agentId, routingBusinessDate());
  return Number(row?.count ?? 0);
}

test('business date follows Los Angeles', () => {
  assert.equal(
    routingBusinessDate(new Date('2026-08-15T06:59:59.000Z')),
    '2026-08-14',
  );
  assert.equal(
    routingBusinessDate(new Date('2026-08-15T07:00:00.000Z')),
    '2026-08-15',
  );
  assert.equal(
    routingBusinessDate(new Date('2026-12-01T07:59:59.000Z')),
    '2026-11-30',
  );
  assert.equal(
    routingBusinessDate(new Date('2026-12-01T08:00:00.000Z')),
    '2026-12-01',
  );
});

test('daily cap skips capped seats and leaves overflow waiting', async () => {
  const database = await createDatabase([
    { id: 'agent-a', name: 'Agent A', limit: 1 },
    { id: 'agent-b', name: 'Agent B', limit: 2 },
  ]);
  for (let index = 1; index <= 4; index += 1) {
    addConversation(database, `conversation-${index}`);
  }

  assert.equal(await assign(database, 'conversation-1'), 'agent-a');
  assert.equal(await assign(database, 'conversation-2'), 'agent-b');
  assert.equal(await assign(database, 'conversation-3'), 'agent-b');
  assert.equal(count(database, 'agent-a'), 1);
  assert.equal(count(database, 'agent-b'), 2);

  const before = database
    .prepare(
      `SELECT site_id, product_id, last_agent_id
       FROM routing_round_robin_cursors
       ORDER BY site_id, product_id`,
    )
    .all();
  assert.equal(await assign(database, 'conversation-4'), null);
  const after = database
    .prepare(
      `SELECT site_id, product_id, last_agent_id
       FROM routing_round_robin_cursors
       ORDER BY site_id, product_id`,
    )
    .all();
  assert.deepEqual(after, before);

  database.close();
});

test('daily cap zero is unlimited', async () => {
  const database = await createDatabase([
    {
      id: 'agent-a',
      name: 'Agent A',
      limit: 0,
    },
  ]);
  for (let index = 1; index <= 3; index += 1) {
    const id = `conversation-${index}`;
    addConversation(database, id);
    assert.equal(await assign(database, id), 'agent-a');
  }
  assert.equal(count(database, 'agent-a'), 3);
  database.close();
});

test('previous-day counts do not block today', async () => {
  const database = await createDatabase([
    {
      id: 'agent-a',
      name: 'Agent A',
      limit: 1,
    },
  ]);
  database
    .prepare(
      `INSERT INTO agent_daily_stats (
         site_id, agent_id, business_date, conversation_count
       ) VALUES ('default', 'agent-a', '2000-01-01', 999)`,
    )
    .run();
  addConversation(database, 'new-day');

  assert.equal(await assign(database, 'new-day'), 'agent-a');
  assert.equal(count(database, 'agent-a'), 1);
  database.close();
});
