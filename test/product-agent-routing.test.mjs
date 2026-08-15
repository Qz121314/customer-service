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
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    INSERT INTO support_groups VALUES ('default', 'legacy', 1);
  `);
  return database;
}

function addAgent(
  database,
  {
    id,
    status = 'online',
    lastAssignedAt = null,
    maxActiveConversations = 0,
    dailyConversationLimit = 0,
  },
) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         max_active_conversations, daily_conversation_limit,
         last_seen_at, last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)`,
    )
    .run(
      id,
      id,
      id,
      `hash-${id}`,
      status,
      maxActiveConversations,
      dailyConversationLimit,
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
  { groupId = 'legacy', sectionId = 'west', categoryId = 'escorts' } = {},
) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id, group_id,
         assigned_agent, status, expires_at, created_at
       ) VALUES (?, 'default', ?, ?, ?, ?, NULL, 'open',
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP)`,
    )
    .run(id, productId, sectionId, categoryId, groupId);
}

test('agents covering the same section receive conversations round-robin', async () => {
  const database = createDatabase();
  addAgent(database, {
    id: 'agent-a',
    lastAssignedAt: '2026-01-01T00:00:00.000Z',
  });
  addAgent(database, { id: 'agent-b' });
  addScope(database, 'agent-a', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-b', { type: 'section', sectionId: 'west' });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-b', {
    categoryId: 'massage',
  });

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

test('configured category never falls back to a legacy group when its agent is unavailable', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'category-agent', status: 'offline' });
  addAgent(database, { id: 'legacy-agent' });
  addScope(database, 'category-agent', {
    type: 'category',
    sectionId: 'west',
    categoryId: 'escorts',
  });
  database.exec(`
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

test('section scope automatically covers a newly introduced product', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'section-agent' });
  addScope(database, 'section-agent', { type: 'section', sectionId: 'west' });

  // No product-specific assignment and no product_catalog row are required.
  addConversation(database, 'conversation-1', 'future-product', {
    sectionId: 'west',
    categoryId: 'new-category',
  });

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment?.id, 'section-agent');
  database.close();
});

test('explicit product scope matches only the selected product', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'product-agent' });
  addAgent(database, { id: 'legacy-agent' });
  addScope(database, 'product-agent', {
    type: 'product',
    productId: 'product-a',
  });
  database.exec(`
    INSERT INTO group_agents VALUES
      ('default', 'legacy', 'legacy-agent', 1);
  `);
  addConversation(database, 'conversation-1', 'product-b');

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment?.id, 'legacy-agent');
  database.close();
});

test('legacy group is used only when no routing scope matches', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'legacy-agent' });
  database.exec(`
    INSERT INTO group_agents VALUES
      ('default', 'legacy', 'legacy-agent', 1);
  `);
  addConversation(database, 'conversation-1', 'product-without-scope');

  const assignment = await assignConversationAgent(
    d1(database),
    'conversation-1',
  );

  assert.equal(assignment?.id, 'legacy-agent');
  database.close();
});

test('concurrent assignments respect capacity and spread work across eligible agents', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'agent-a', maxActiveConversations: 1 });
  addAgent(database, { id: 'agent-b', maxActiveConversations: 1 });
  addScope(database, 'agent-a', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-b', { type: 'section', sectionId: 'west' });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-b');

  const db = d1(database);
  const [first, second] = await Promise.all([
    assignConversationAgent(db, 'conversation-1'),
    assignConversationAgent(db, 'conversation-2'),
  ]);

  assert.deepEqual(
    new Set([first?.id, second?.id]),
    new Set(['agent-a', 'agent-b']),
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversations
         WHERE assigned_agent = 'agent-a'`,
      )
      .get().count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversations
         WHERE assigned_agent = 'agent-b'`,
      )
      .get().count,
    1,
  );
  database.close();
});

test('daily conversation limit closes routing after quota and reopens next business day', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'quota-agent', dailyConversationLimit: 2 });
  addScope(database, 'quota-agent', { type: 'section', sectionId: 'west' });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-b');
  addConversation(database, 'conversation-3', 'product-c');

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');
  const third = await assignConversationAgent(db, 'conversation-3');

  assert.equal(first?.id, 'quota-agent');
  assert.equal(second?.id, 'quota-agent');
  assert.equal(third, null);

  const today = database
    .prepare(
      `SELECT assigned_business_date AS day
       FROM conversations WHERE id = 'conversation-1'`,
    )
    .get().day;
  database
    .prepare(
      `UPDATE conversations
       SET assigned_business_date = '2000-01-01'
       WHERE assigned_agent = 'quota-agent'`,
    )
    .run();

  const reopened = await assignConversationAgent(db, 'conversation-3');
  assert.equal(reopened?.id, 'quota-agent');
  assert.ok(today && today !== '2000-01-01');
  database.close();
});
