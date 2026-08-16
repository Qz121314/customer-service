import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  assignConversationAgent,
  routingBusinessDate,
} from '../src/worker/routing.ts';

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

function databaseWithQuota(limit) {
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
      section_id TEXT,
      category_id TEXT,
      group_id TEXT,
      assigned_agent TEXT,
      assigned_at TEXT,
      assigned_business_date TEXT,
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
        conversation_count = conversation_count + 1;
    END;

    INSERT INTO support_groups VALUES ('default', 'legacy', 1);
    INSERT INTO agents (
      id, site_id, name, username, password_hash, status, is_enabled,
      max_active_conversations, daily_conversation_limit,
      last_seen_at, last_assigned_at
    ) VALUES (
      'agent-a', 'default', 'Agent A', 'agent-a', 'hash', 'online', 1,
      0, ${Number(limit)}, CURRENT_TIMESTAMP, NULL
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', 'agent-a', 'section', 'west', '', '', 1);
  `);
  return database;
}

function addConversation(database, id) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id, group_id,
         assigned_agent, status, expires_at, created_at
       ) VALUES (?, 'default', ?, 'west', 'escorts', 'legacy', NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id, `product-${id}`);
}

test('daily quota uses Los Angeles natural-day boundaries', () => {
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

test('concurrent routing cannot exceed the daily conversation quota', async () => {
  const database = databaseWithQuota(1);
  addConversation(database, 'conversation-1');
  addConversation(database, 'conversation-2');

  const db = d1(database);
  const results = await Promise.all([
    assignConversationAgent(db, 'conversation-1'),
    assignConversationAgent(db, 'conversation-2'),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversations
         WHERE assigned_agent = 'agent-a'
           AND assigned_business_date IS NOT NULL`,
      )
      .get().count,
    1,
  );
  database.close();
});
