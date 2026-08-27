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
  `);
  database.exec(
    await read('../migrations/0042_simple_round_robin_routing.sql'),
  );
  return database;
}

function addAgent(
  database,
  {
    id,
    status = 'online',
    enabled = true,
    dailyConversationLimit = 0,
    quotaEnabled = false,
    quotaTotal = 0,
    quotaUsed = 0,
    lastAssignedAt = null,
  },
) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used, last_seen_at,
         last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(
      id,
      id,
      id,
      `hash-${id}`,
      status,
      enabled ? 1 : 0,
      dailyConversationLimit,
      quotaEnabled ? 1 : 0,
      quotaTotal,
      quotaUsed,
      lastAssignedAt,
    );
}

function addScope(
  database,
  agentId,
  { type, sectionId = '', categoryId = '', productId = '' },
) {
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
       ) VALUES ('default', ?, ?, ?, ?, ?, 1)`,
    )
    .run(agentId, type, sectionId, categoryId, productId);
}

function addConversation(
  database,
  id,
  productId,
  { sectionId = 'west', categoryId = 'escorts' } = {},
) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id,
         assigned_agent, status, expires_at, created_at
       ) VALUES (?, 'default', ?, ?, ?, NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id, productId, sectionId, categoryId);
}

test('matching seats receive fresh conversations in deterministic round robin', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }
  for (let index = 1; index <= 4; index += 1) {
    addConversation(database, `conversation-${index}`, `product-${index}`);
  }

  const db = d1(database);
  const assigned = [];
  for (let index = 1; index <= 4; index += 1) {
    assigned.push(
      (await assignConversationAgent(db, `conversation-${index}`))?.id,
    );
  }

  assert.deepEqual(assigned, ['agent-a', 'agent-b', 'agent-c', 'agent-a']);
  database.close();
});

test('offline and busy seats remain eligible for automatic traffic', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'agent-offline', status: 'offline' });
  addAgent(database, { id: 'agent-busy', status: 'busy' });
  addScope(database, 'agent-offline', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-busy', { type: 'section', sectionId: 'west' });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-b');

  const db = d1(database);
  assert.equal(
    (await assignConversationAgent(db, 'conversation-1'))?.id,
    'agent-busy',
  );
  assert.equal(
    (await assignConversationAgent(db, 'conversation-2'))?.id,
    'agent-offline',
  );
  database.close();
});

test('active two-hour affinity keeps traffic on its offline seat', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'agent-a', status: 'offline' });
  addAgent(database, { id: 'agent-b' });
  addScope(database, 'agent-a', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-b', { type: 'section', sectionId: 'west' });
  addConversation(database, 'protected-conversation', 'product-1');
  database.exec(`
    UPDATE conversations
    SET cta_affinity_agent_id = 'agent-a',
        cta_affinity_expires_at = datetime('now', '+2 hours')
    WHERE id = 'protected-conversation';
  `);

  const assignment = await assignConversationAgent(
    d1(database),
    'protected-conversation',
  );
  assert.equal(assignment?.id, 'agent-a');
  database.close();
});

test('disabled or quota-exhausted affinity falls back without waiting', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'disabled-agent', enabled: false });
  addAgent(database, {
    id: 'exhausted-agent',
    quotaEnabled: true,
    quotaTotal: 2,
    quotaUsed: 2,
  });
  addAgent(database, { id: 'available-agent' });
  for (const id of ['disabled-agent', 'exhausted-agent', 'available-agent']) {
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }
  addConversation(database, 'disabled-affinity', 'product-a');
  addConversation(database, 'exhausted-affinity', 'product-b');
  database.exec(`
    UPDATE conversations
    SET cta_affinity_agent_id = 'disabled-agent',
        cta_affinity_expires_at = datetime('now', '+2 hours')
    WHERE id = 'disabled-affinity';
    UPDATE conversations
    SET cta_affinity_agent_id = 'exhausted-agent',
        cta_affinity_expires_at = datetime('now', '+2 hours')
    WHERE id = 'exhausted-affinity';
  `);

  const db = d1(database);
  assert.equal(
    (await assignConversationAgent(db, 'disabled-affinity'))?.id,
    'available-agent',
  );
  assert.equal(
    (await assignConversationAgent(db, 'exhausted-affinity'))?.id,
    'available-agent',
  );
  database.close();
});

test('section, category and product scopes remain authoritative', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'section-agent' });
  addAgent(database, { id: 'category-agent' });
  addAgent(database, { id: 'product-agent' });
  addScope(database, 'section-agent', { type: 'section', sectionId: 'east' });
  addScope(database, 'category-agent', {
    type: 'category',
    sectionId: 'west',
    categoryId: 'massage',
  });
  addScope(database, 'product-agent', {
    type: 'product',
    productId: 'special-product',
  });
  addConversation(database, 'section-conversation', 'section-product', {
    sectionId: 'east',
  });
  addConversation(database, 'category-conversation', 'category-product', {
    categoryId: 'massage',
  });
  addConversation(database, 'product-conversation', 'special-product');

  const db = d1(database);
  assert.equal(
    (await assignConversationAgent(db, 'section-conversation'))?.id,
    'section-agent',
  );
  assert.equal(
    (await assignConversationAgent(db, 'category-conversation'))?.id,
    'category-agent',
  );
  assert.equal(
    (await assignConversationAgent(db, 'product-conversation'))?.id,
    'product-agent',
  );
  database.close();
});

test('conversation without a matching scope remains unassigned', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'unrelated-agent' });
  addScope(database, 'unrelated-agent', {
    type: 'section',
    sectionId: 'east',
  });
  addConversation(database, 'conversation-1', 'product-without-scope');

  assert.equal(
    await assignConversationAgent(d1(database), 'conversation-1'),
    null,
  );
  database.close();
});
