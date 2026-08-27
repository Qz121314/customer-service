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
        async run() {
          const result = database.prepare(sql).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

async function createDatabase({ quotaEnabled = true, quotaTotal = 2 } = {}) {
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
      requeue_excluded_agent_id TEXT,
      source_handoff_id TEXT,
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
      conversation_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      received_at TEXT NOT NULL,
      source_handoff_id TEXT
    );
  `);
  database.exec(await read('../migrations/0023_agent_traffic_quotas.sql'));
  database.exec(await read('../migrations/0033_new_traffic_limit_guard.sql'));
  database.exec(
    await read('../migrations/0042_simple_round_robin_routing.sql'),
  );
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         last_seen_at, traffic_quota_enabled, traffic_quota_total
       ) VALUES (
         'agent-a', 'default', 'Agent A', 'agent-a', 'hash', 'online', 1,
         CURRENT_TIMESTAMP, ?, ?
       )`,
    )
    .run(quotaEnabled ? 1 : 0, quotaTotal);
  database.exec(`
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
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
       ) VALUES (
         ?, 'default', ?, 'west', 'escorts', NULL, NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP
       )`,
    )
    .run(id, `product-${id}`);
}

test('seat quota is consumed once and exhausted seats stop receiving traffic', async () => {
  const database = await createDatabase();
  addConversation(database, 'conversation-1');
  addConversation(database, 'conversation-2');
  addConversation(database, 'conversation-3');

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-1'))?.id,
    'agent-a',
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
  );

  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL, assigned_at = NULL,
        assigned_business_date = NULL, status = 'open'
    WHERE id = 'conversation-1';
  `);
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-1'))?.id,
    'agent-a',
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
    'requeueing the same conversation must not consume quota twice',
  );

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-2'))?.id,
    'agent-a',
  );
  assert.equal(
    await assignConversationAgent(d1(database), 'conversation-3'),
    null,
    'an exhausted seat must be excluded from fresh routing',
  );

  database.exec(
    `UPDATE agents SET traffic_quota_total = traffic_quota_total + 1`,
  );
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-3'))?.id,
    'agent-a',
    'adding quota should make the seat eligible again',
  );
  const finalQuota = database
    .prepare(
      `SELECT traffic_quota_total AS total, traffic_quota_used AS used
       FROM agents`,
    )
    .get();
  assert.equal(finalQuota.total, 3);
  assert.equal(finalQuota.used, 3);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_traffic_receipts
         WHERE quota_consumed = 1`,
      )
      .get().count,
    3,
  );
});

test('already-counted traffic still obeys daily cap without consuming quota twice', async () => {
  const database = await createDatabase({ quotaTotal: 1 });
  database.exec(`UPDATE agents SET daily_conversation_limit = 1`);
  addConversation(database, 'conversation-paid');
  addConversation(database, 'conversation-fresh');

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-paid'))?.id,
    'agent-a',
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
  );
  assert.equal(
    database.prepare(`SELECT conversation_count FROM agent_daily_stats`).get()
      .conversation_count,
    1,
  );

  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL, assigned_at = NULL,
        assigned_business_date = NULL, status = 'open'
    WHERE id = 'conversation-paid';
  `);

  assert.equal(
    await assignConversationAgent(d1(database), 'conversation-paid'),
    null,
    'an unassigned conversation must still obey the daily reception limit',
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
  );
  assert.equal(
    database.prepare(`SELECT conversation_count FROM agent_daily_stats`).get()
      .conversation_count,
    1,
  );

  database.exec(`UPDATE agents SET daily_conversation_limit = 2`);
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-paid'))?.id,
    'agent-a',
    'raising daily capacity may restore already-paid traffic without another quota unit',
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
  );
  assert.equal(
    database.prepare(`SELECT conversation_count FROM agent_daily_stats`).get()
      .conversation_count,
    1,
  );
  assert.equal(
    await assignConversationAgent(d1(database), 'conversation-fresh'),
    null,
    'fresh traffic must remain blocked after paid quota is exhausted',
  );
});

test('database guard rejects fresh assignment that bypasses routing quota checks', async () => {
  const database = await createDatabase({ quotaTotal: 1 });
  addConversation(database, 'conversation-1');
  addConversation(database, 'conversation-bypass');

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-1'))?.id,
    'agent-a',
  );
  const businessDate = database
    .prepare(
      `SELECT assigned_business_date AS business_date
       FROM conversations WHERE id = 'conversation-1'`,
    )
    .get().business_date;

  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE conversations
           SET assigned_agent = 'agent-a',
               assigned_at = CURRENT_TIMESTAMP,
               assigned_business_date = ?,
               status = 'pending'
           WHERE id = 'conversation-bypass'`,
        )
        .run(businessDate),
    /AGENT_NEW_TRAFFIC_LIMIT_EXHAUSTED/u,
  );
  assert.equal(
    database
      .prepare(
        `SELECT assigned_agent FROM conversations
         WHERE id = 'conversation-bypass'`,
      )
      .get().assigned_agent,
    null,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_traffic_receipts
         WHERE conversation_id = 'conversation-bypass'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    database.prepare(`SELECT traffic_quota_used FROM agents`).get()
      .traffic_quota_used,
    1,
  );
});

test('legacy seats remain unlimited until quota control is enabled', async () => {
  const database = await createDatabase({ quotaEnabled: false, quotaTotal: 0 });
  addConversation(database, 'conversation-unlimited');
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-unlimited'))?.id,
    'agent-a',
  );
  assert.equal(
    database
      .prepare(
        `SELECT traffic_quota_used AS used FROM agents WHERE id = 'agent-a'`,
      )
      .get().used,
    0,
  );
  assert.equal(
    database
      .prepare(
        `SELECT quota_consumed FROM agent_traffic_receipts
         WHERE conversation_id = 'conversation-unlimited'`,
      )
      .get().quota_consumed,
    -1,
  );
});
