import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
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
        async all() {
          return { results: database.prepare(sql).all(...bindings) };
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
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    usernameConfigured = true,
    passwordConfigured = true,
    notificationsEnabled = true,
    notificationExpirationTime = null,
  },
) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used, last_seen_at,
         last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
    )
    .run(
      id,
      id,
      usernameConfigured ? id : null,
      passwordConfigured ? `hash-${id}` : null,
      status,
      enabled ? 1 : 0,
      dailyConversationLimit,
      quotaEnabled ? 1 : 0,
      quotaTotal,
      quotaUsed,
      lastAssignedAt,
    );
  if (notificationsEnabled) {
    database
      .prepare(
        `INSERT INTO agent_push_subscriptions (
           endpoint, agent_id, expiration_time
         ) VALUES (?, ?, ?)`,
      )
      .run(
        `https://push.example.test/${id}`,
        id,
        notificationExpirationTime,
      );
  }
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
  {
    sectionId = 'west',
    categoryId = 'escorts',
    lastMessageAt = '2026-08-01 00:00:00',
  } = {},
) {
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, product_id, section_id, category_id,
         assigned_agent, status, expires_at, last_message_at, created_at
       ) VALUES (?, 'default', ?, ?, ?, NULL, 'open',
         '2099-01-01T00:00:00.000Z', ?, CURRENT_TIMESTAMP)`,
    )
    .run(id, productId, sectionId, categoryId, lastMessageAt);
}

async function assigned(database, id) {
  return (await assignConversationAgent(d1(database), id))?.id ?? null;
}

test('one site uses strict circular round robin', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }
  for (let index = 1; index <= 6; index += 1) {
    addConversation(database, `conversation-${index}`, 'product-west');
  }

  const assignedAgents = [];
  for (let index = 1; index <= 6; index += 1) {
    assignedAgents.push(await assigned(database, `conversation-${index}`));
  }

  assert.deepEqual(assignedAgents, [
    'agent-a',
    'agent-b',
    'agent-c',
    'agent-a',
    'agent-b',
    'agent-c',
  ]);
  database.close();
});

test('different products share one site-wide round robin cursor', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }

  const steps = [
    ['conversation-1', 'product-a'],
    ['conversation-2', 'product-b'],
    ['conversation-3', 'product-c'],
    ['conversation-4', 'product-a'],
    ['conversation-5', 'product-d'],
    ['conversation-6', 'product-b'],
  ];
  const assignedAgents = [];
  for (const [id, productId] of steps) {
    addConversation(database, id, productId);
    assignedAgents.push(await assigned(database, id));
  }

  assert.deepEqual(assignedAgents, [
    'agent-a',
    'agent-b',
    'agent-c',
    'agent-a',
    'agent-b',
    'agent-c',
  ]);
  assert.deepEqual(
    database
      .prepare(
        `SELECT site_id, last_agent_id
         FROM routing_round_robin_cursors`,
      )
      .all()
      .map((row) => ({ ...row })),
    [{ site_id: 'default', last_agent_id: 'agent-c' }],
  );
  database.close();
});

test('global cursor skips seats outside the current product scope', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c', 'agent-d']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'product', productId: 'base-product' });
  }
  for (const id of ['agent-a', 'agent-b']) {
    addScope(database, id, { type: 'product', productId: 'target-product' });
  }

  for (let index = 1; index <= 3; index += 1) {
    addConversation(database, `base-${index}`, 'base-product');
    assert.equal(
      await assigned(database, `base-${index}`),
      `agent-${String.fromCharCode(96 + index)}`,
    );
  }

  addConversation(database, 'target-1', 'target-product');
  assert.equal(await assigned(database, 'target-1'), 'agent-a');
  database.close();
});

test('only seats with complete base eligibility receive automatic traffic', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'agent-offline', status: 'offline' });
  addAgent(database, { id: 'agent-busy', status: 'busy' });
  addAgent(database, { id: 'agent-online', status: 'online' });
  addAgent(database, {
    id: 'agent-no-username',
    usernameConfigured: false,
  });
  addAgent(database, {
    id: 'agent-no-password',
    passwordConfigured: false,
  });
  addScope(database, 'agent-offline', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-busy', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-online', { type: 'section', sectionId: 'west' });
  addScope(database, 'agent-no-username', {
    type: 'section',
    sectionId: 'west',
  });
  addScope(database, 'agent-no-password', {
    type: 'section',
    sectionId: 'west',
  });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-a');

  assert.equal(await assigned(database, 'conversation-1'), 'agent-online');
  assert.equal(await assigned(database, 'conversation-2'), 'agent-online');
  database.close();
});

test('online seats need a valid push subscription for new automatic traffic', async () => {
  const database = await createDatabase();
  addAgent(database, {
    id: 'agent-no-push',
    notificationsEnabled: false,
  });
  addAgent(database, {
    id: 'agent-expired-push',
    notificationExpirationTime: Date.now() - 60_000,
  });
  addAgent(database, { id: 'agent-reachable' });
  for (const id of ['agent-no-push', 'agent-expired-push', 'agent-reachable']) {
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }
  addConversation(database, 'conversation-1', 'product-a');

  assert.equal(await assigned(database, 'conversation-1'), 'agent-reachable');

  database.exec(`DELETE FROM agent_push_subscriptions`);
  addConversation(database, 'conversation-2', 'product-a');
  assert.equal(await assigned(database, 'conversation-2'), null);
  database.close();
});

test('online seats remain eligible regardless of last activity time', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'online-agent' });
  addScope(database, 'online-agent', {
    type: 'section',
    sectionId: 'west',
  });
  database.exec(`
    UPDATE agents
    SET last_seen_at = datetime('now', '-30 days')
    WHERE id = 'online-agent';
  `);
  addConversation(database, 'conversation-1', 'product-a');

  assert.equal(await assigned(database, 'conversation-1'), 'online-agent');
  database.close();
});

for (const unavailableStatus of ['busy', 'offline']) {
  test(`${unavailableStatus} is only an eligibility gate and rejoins naturally`, async () => {
    const database = await createDatabase();
    for (const id of ['agent-a', 'agent-b', 'agent-c']) {
      addAgent(database, { id });
      addScope(database, id, { type: 'section', sectionId: 'west' });
    }

    addConversation(database, 'conversation-1', 'product-west');
    assert.equal(await assigned(database, 'conversation-1'), 'agent-a');
    database
      .prepare('UPDATE agents SET status = ? WHERE id = ?')
      .run(unavailableStatus, 'agent-b');
    addConversation(database, 'conversation-2', 'product-west');
    assert.equal(await assigned(database, 'conversation-2'), 'agent-c');

    database.exec(`UPDATE agents SET status = 'online' WHERE id = 'agent-b'`);
    addConversation(database, 'conversation-3', 'product-west');
    addConversation(database, 'conversation-4', 'product-west');
    assert.equal(await assigned(database, 'conversation-3'), 'agent-a');
    assert.equal(await assigned(database, 'conversation-4'), 'agent-b');
    database.close();
  });
}

test('an enabled seat rejoins its prior ring without priority', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }

  addConversation(database, 'conversation-1', 'product-west');
  assert.equal(await assigned(database, 'conversation-1'), 'agent-a');
  database.exec(`UPDATE agents SET is_enabled = 0 WHERE id = 'agent-b'`);
  addConversation(database, 'conversation-2', 'product-west');
  assert.equal(await assigned(database, 'conversation-2'), 'agent-c');

  database.exec(`UPDATE agents SET is_enabled = 1 WHERE id = 'agent-b'`);
  addConversation(database, 'conversation-3', 'product-west');
  addConversation(database, 'conversation-4', 'product-west');
  assert.equal(await assigned(database, 'conversation-3'), 'agent-a');
  assert.equal(await assigned(database, 'conversation-4'), 'agent-b');
  database.close();
});

test('a daily-cap reset only restores normal ring eligibility', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }

  addConversation(database, 'conversation-1', 'product-west');
  assert.equal(await assigned(database, 'conversation-1'), 'agent-a');
  database.exec(
    `UPDATE agents SET daily_conversation_limit = 1 WHERE id = 'agent-b'`,
  );
  database
    .prepare(
      `INSERT INTO agent_daily_stats (
         site_id, agent_id, business_date, conversation_count
       ) VALUES ('default', 'agent-b', ?, 1)`,
    )
    .run(routingBusinessDate());
  addConversation(database, 'conversation-2', 'product-west');
  assert.equal(await assigned(database, 'conversation-2'), 'agent-c');

  database.exec(`DELETE FROM agent_daily_stats WHERE agent_id = 'agent-b'`);
  addConversation(database, 'conversation-3', 'product-west');
  addConversation(database, 'conversation-4', 'product-west');
  assert.equal(await assigned(database, 'conversation-3'), 'agent-a');
  assert.equal(await assigned(database, 'conversation-4'), 'agent-b');
  database.close();
});

test('restored quota rejoins the ring without catch-up priority', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }

  addConversation(database, 'conversation-1', 'product-west');
  assert.equal(await assigned(database, 'conversation-1'), 'agent-a');
  database.exec(`
    UPDATE agents
    SET traffic_quota_enabled = 1,
        traffic_quota_total = 0,
        traffic_quota_used = 0
    WHERE id = 'agent-b';
  `);
  addConversation(database, 'conversation-2', 'product-west');
  assert.equal(await assigned(database, 'conversation-2'), 'agent-c');

  database.exec(`
    UPDATE agents
    SET traffic_quota_total = 1
    WHERE id = 'agent-b';
  `);
  addConversation(database, 'conversation-3', 'product-west');
  addConversation(database, 'conversation-4', 'product-west');
  assert.equal(await assigned(database, 'conversation-3'), 'agent-a');
  assert.equal(await assigned(database, 'conversation-4'), 'agent-b');
  database.close();
});

test('affinity falls back when its seat is offline', async () => {
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

  assert.equal(await assigned(database, 'protected-conversation'), 'agent-b');
  database.close();
});

test('eligible CTA affinity takes precedence over the global cursor', async () => {
  const database = await createDatabase();
  for (const id of ['agent-a', 'agent-b', 'agent-c']) {
    addAgent(database, { id });
    addScope(database, id, { type: 'section', sectionId: 'west' });
  }
  addConversation(database, 'conversation-1', 'product-west');
  assert.equal(await assigned(database, 'conversation-1'), 'agent-a');

  addConversation(database, 'protected-conversation', 'product-west');
  database.exec(`
    UPDATE conversations
    SET cta_affinity_agent_id = 'agent-c',
        cta_affinity_expires_at = datetime('now', '+2 hours')
    WHERE id = 'protected-conversation';
  `);

  assert.equal(await assigned(database, 'protected-conversation'), 'agent-c');
  database.close();
});

test('disabled or exhausted affinity falls back', async () => {
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

  assert.equal(
    await assigned(database, 'disabled-affinity'),
    'available-agent',
  );
  assert.equal(
    await assigned(database, 'exhausted-affinity'),
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

  assert.equal(
    await assigned(database, 'section-conversation'),
    'section-agent',
  );
  assert.equal(
    await assigned(database, 'category-conversation'),
    'category-agent',
  );
  assert.equal(
    await assigned(database, 'product-conversation'),
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