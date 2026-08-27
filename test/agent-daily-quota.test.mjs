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

async function routingDatabase(agents) {
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

    CREATE TRIGGER test_assignment_daily_stats
    AFTER UPDATE OF assigned_agent ON conversations
    WHEN OLD.assigned_agent IS NULL
      AND NEW.assigned_agent IS NOT NULL
      AND NEW.assigned_business_date IS NOT NULL
    BEGIN
      INSERT INTO agent_daily_stats (
        site_id, agent_id, business_date, conversation_count
      ) VALUES (
        NEW.site_id, NEW.assigned_agent, NEW.assigned_business_date, 1
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
           id, site_id, name, username, password_hash, status, is_enabled,
           daily_conversation_limit
         ) VALUES (?, 'default', ?, ?, 'hash', 'offline', 1, ?)`,
      )
      .run(agent.id, agent.name, agent.id, agent.dailyLimit);
    database
      .prepare(
        `INSERT INTO agent_routing_scopes (
           site_id, agent_id, scope_type, section_id,
           category_id, product_id, is_enabled
         ) VALUES ('default', ?, 'section', 'west', '', '', 1)`,
      )
      .run(agent.id);
  }

  database.exec(
    await read('../migrations/0042_simple_round_robin_routing.sql'),
  );
  return database;
}

function addConversation(database, id) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id,
         assigned_agent, status, expires_at, created_at
       ) VALUES (?, 'default', ?, 'west', 'support', NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id, `product-${id}`);
}

function assignedAgent(database, conversationId) {
  return database
    .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
    .get(conversationId).assigned_agent;
}

function todayCount(database, agentId) {
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

test('daily reporting uses Los Angeles natural-day boundaries', () => {
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

test('a seat stops receiving new routing after reaching its daily limit', async () => {
  const database = await routingDatabase([
    { id: 'agent-a', name: 'Agent A', dailyLimit: 1 },
    { id: 'agent-b', name: 'Agent B', dailyLimit: 2 },
  ]);
  for (let index = 1; index <= 4; index += 1) {
    addConversation(database, `conversation-${index}`);
  }

  const db = d1(database);
  assert.equal(
    (await assignConversationAgent(db, 'conversation-1'))?.id,
    'agent-a',
  );
  assert.equal(
    (await assignConversationAgent(db, 'conversation-2'))?.id,
    'agent-b',
  );

  const third = await assignConversationAgent(db, 'conversation-3');
  assert.equal(
    third?.id,
    'agent-b',
    'agent-a must be skipped after reaching 1/1',
  );
  assert.equal(assignedAgent(database, 'conversation-3'), 'agent-b');
  assert.equal(todayCount(database, 'agent-a'), 1);
  assert.equal(todayCount(database, 'agent-b'), 2);

  const cursorBeforeWaiting = database
    .prepare('SELECT id, round_robin_seq FROM agents ORDER BY id')
    .all();
  const fourth = await assignConversationAgent(db, 'conversation-4');
  const cursorAfterWaiting = database
    .prepare('SELECT id, round_robin_seq FROM agents ORDER BY id')
    .all();

  assert.equal(
    fourth,
    null,
    'all capped seats must leave the conversation waiting',
  );
  assert.equal(assignedAgent(database, 'conversation-4'), null);
  assert.deepEqual(
    cursorAfterWaiting,
    cursorBeforeWaiting,
    'a failed assignment must not consume a round-robin position',
  );

  database.close();
});

test('daily limit zero means unlimited', async () => {
  const database = await routingDatabase([
    { id: 'agent-unlimited', name: 'Unlimited Agent', dailyLimit: 0 },
  ]);
  const db = d1(database);

  for (let index = 1; index <= 3; index += 1) {
    const id = `unlimited-${index}`;
    addConversation(database, id);
    assert.equal((await assignConversationAgent(db, id))?.id, 'agent-unlimited');
  }

  assert.equal(todayCount(database, 'agent-unlimited'), 3);
  database.close();
});

test('counts from a previous business day do not block the new day', async () => {
  const database = await routingDatabase([
    { id: 'agent-a', name: 'Agent A', dailyLimit: 1 },
  ]);
  database
    .prepare(
      `INSERT INTO agent_daily_stats (
         site_id, agent_id, business_date, conversation_count
       ) VALUES ('default', 'agent-a', '2000-01-01', 999)`,
    )
    .run();
  addConversation(database, 'new-business-day');

  const result = await assignConversationAgent(d1(database), 'new-business-day');
  assert.equal(result?.id, 'agent-a');
  assert.equal(todayCount(database, 'agent-a'), 1);

  database.close();
});
