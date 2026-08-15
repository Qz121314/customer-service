import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const sharedDirectory = fileURLToPath(
  new URL('../src/shared/', import.meta.url),
);
const moduleShims = [];
for (const directory of [workerDirectory, sharedDirectory]) {
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
    const shimPath = join(directory, name.slice(0, -3));
    if (existsSync(shimPath)) continue;
    symlinkSync(name, shimPath);
    moduleShims.push(shimPath);
  }
}

let adminConfigApi;
let agentApi;
let clientApi;
try {
  [{ adminConfigApi }, { agentApi }, { clientApi }] = await Promise.all([
    import('../src/worker/admin-config-api.ts'),
    import('../src/worker/agent-api.ts'),
    import('../src/worker/client-api.ts'),
  ]);
} finally {
  for (const shimPath of moduleShims) unlinkSync(shimPath);
}

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database) {
  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    prepare: statement,
    async batch(statements) {
      const results = [];
      database.exec('BEGIN');
      try {
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fakeRooms() {
  const events = new Map();
  return {
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            const payload = JSON.parse(String(init?.body ?? '{}'));
            const current = events.get(name) ?? [];
            current.push(payload);
            events.set(name, current);
            return { status: 204 };
          },
        };
      },
    },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function adminCookie(password) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', password)
    .update(payload)
    .digest('base64url');
  return `cs_session=${payload}.${signature}`;
}

test('admin can save multiple whole-section routing rules in one request', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, section_id, section_name, is_enabled
    ) VALUES
      ('default', 'product-west', 'West product', 'west', 'West', 1),
      ('default', 'product-east', 'East product', 'east', 'East', 1);
  `);

  const adminPassword = 'admin-password';
  const response = await adminConfigApi.request(
    '/api/admin/agents',
    {
      method: 'POST',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Multi Section Agent',
        username: 'multi-section',
        password: 'pass',
        routingScope: { type: 'section', sectionIds: ['west', 'east'] },
        maxActiveConversations: 0,
        dailyConversationLimit: 0,
        isEnabled: true,
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  const created = await json(response);

  assert.equal(response.status, 201);
  assert.deepEqual(
    database
      .prepare(
        `SELECT section_id
         FROM agent_routing_scopes
         WHERE agent_id = ? AND scope_type = 'section'
         ORDER BY section_id`,
      )
      .all(created.id)
      .map((row) => row.section_id),
    ['east', 'west'],
  );
  database.close();
});

async function json(response) {
  const value = await response.json();
  assert.ok(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}

test('isolated client -> routing -> agent -> client flow works through real Hono handlers', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const db = d1(database);
  const rooms = fakeRooms();
  const env = { DB: db, CONVERSATION_ROOMS: rooms.namespace };

  const token = 'agent-session-e2e';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, max_active_conversations, last_seen_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 'online', 1, 5, CURRENT_TIMESTAMP)`,
    )
    .run('agent-e2e', 'Agent E2E', 'agent-e2e', 'hash', 'salt');
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run('session-e2e', 'agent-e2e', sha256(token), expiresAt);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
       ) VALUES ('default', 'agent-e2e', 'section', 'west', '', '', 1)`,
    )
    .run();

  const visitorId = 'TST123';
  const createResponse = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        clientMessageId: 'client-message-e2e-1',
        message: 'Hello from visitor',
        product: {
          id: 'product-e2e',
          sectionId: 'west',
          sectionName: 'West',
          categoryId: 'massage',
          categoryName: 'Massage',
          title: 'Product E2E',
          href: '/sections/west/products/product-e2e/',
          coverUrl: null,
        },
      }),
    },
    env,
  );
  const created = await json(createResponse);
  assert.equal(createResponse.status, 201);
  const conversationId = created.conversation.id;
  assert.ok(conversationId);
  assert.equal(created.conversation.agentName, 'Agent E2E');
  assert.equal(created.conversation.status, 'active');
  assert.equal(created.conversation.messages.length, 1);
  assert.equal(created.conversation.messages[0].direction, 'customer');

  const assigned = database
    .prepare(
      `SELECT assigned_agent, status, section_id, category_id
       FROM conversations WHERE id = ?`,
    )
    .get(conversationId);
  assert.equal(assigned.assigned_agent, 'agent-e2e');
  assert.equal(assigned.status, 'pending');
  assert.equal(assigned.section_id, 'west');
  assert.equal(assigned.category_id, 'massage');

  const cookie = `cs_agent_session=${token}`;
  const inboxResponse = await agentApi.request(
    '/api/agent/conversations',
    { headers: { cookie } },
    env,
  );
  const inbox = await json(inboxResponse);
  assert.equal(inbox.conversations.length, 1);
  assert.equal(inbox.conversations[0].id, conversationId);
  assert.equal(inbox.conversations[0].assigned_agent, 'agent-e2e');

  const replyResponse = await agentApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Hello from agent',
        clientMessageId: 'agent-message-e2e-1',
      }),
    },
    env,
  );
  assert.equal(replyResponse.status, 201);
  const reply = await json(replyResponse);
  assert.equal(reply.message.sender_type, 'agent');
  assert.equal(reply.message.body, 'Hello from agent');

  const retryResponse = await agentApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Hello from agent',
        clientMessageId: 'agent-message-e2e-1',
      }),
    },
    env,
  );
  assert.equal(retryResponse.status, 200);
  const retried = await json(retryResponse);
  assert.equal(retried.message.id, reply.message.id);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ? AND client_message_id = ?`,
      )
      .get(conversationId, 'agent-message-e2e-1').count,
    1,
  );

  const clientDetailResponse = await clientApi.request(
    `/client/v1/conversations/${encodeURIComponent(conversationId)}?visitorId=${encodeURIComponent(visitorId)}`,
    undefined,
    env,
  );
  const clientDetail = await json(clientDetailResponse);
  assert.equal(clientDetail.conversation.messages.length, 2);
  assert.equal(
    clientDetail.conversation.messages[0].body,
    'Hello from visitor',
  );
  assert.equal(clientDetail.conversation.messages[1].body, 'Hello from agent');
  assert.equal(clientDetail.conversation.messages[1].direction, 'agent');

  const visitorEvents = rooms.events.get(`client:default:${visitorId}`) ?? [];
  assert.ok(
    visitorEvents.some(
      (event) =>
        event.type === 'message.created' &&
        event.conversationId === conversationId &&
        event.message?.body === 'Hello from agent',
    ),
  );
  const inboxEvents = rooms.events.get('agent-inbox:agent-e2e') ?? [];
  assert.ok(
    inboxEvents.some(
      (event) =>
        event.type === 'conversation.changed' &&
        event.conversation?.id === conversationId,
    ),
  );
  assert.equal(rooms.events.has('admin-inbox'), false);

  const paused = await json(
    await agentApi.request(
      '/api/agent/auth/status',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'busy' }),
      },
      env,
    ),
  );
  assert.equal(paused.availability, 'busy');
  const heartbeatResult = await json(
    await agentApi.request(
      '/api/agent/auth/heartbeat',
      { method: 'POST', headers: { cookie } },
      env,
    ),
  );
  assert.equal(heartbeatResult.availability, 'busy');
  assert.equal(
    database.prepare('SELECT status FROM agents WHERE id = ?').get('agent-e2e')
      .status,
    'busy',
  );
  const resumed = await json(
    await agentApi.request(
      '/api/agent/auth/status',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'online' }),
      },
      env,
    ),
  );
  assert.equal(resumed.availability, 'online');

  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, max_active_conversations, last_seen_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 'online', 1, 5, CURRENT_TIMESTAMP)`,
    )
    .run('agent-standby', 'Agent Standby', 'agent-standby', 'hash', 'salt');
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
       ) VALUES ('default', 'agent-standby', 'section', 'west', '', '', 1)`,
    )
    .run();

  const adminPassword = 'admin-password';
  const disableResponse = await adminConfigApi.request(
    '/api/admin/agents/agent-e2e',
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isEnabled: false }),
    },
    { ...env, ADMIN_PASSWORD: adminPassword },
  );
  await json(disableResponse);

  const disabledAgent = database
    .prepare('SELECT status, is_enabled FROM agents WHERE id = ?')
    .get('agent-e2e');
  assert.equal(disabledAgent.status, 'offline');
  assert.equal(disabledAgent.is_enabled, 0);
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?',
      )
      .get('agent-e2e').count,
    0,
  );
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(conversationId).assigned_agent,
    'agent-standby',
  );
  assert.ok(
    (rooms.events.get('agent-inbox:agent-standby') ?? []).some(
      (event) =>
        event.type === 'conversation.changed' &&
        event.conversation?.id === conversationId,
    ),
  );

  const standbyToken = 'agent-session-standby';
  const transferToken = 'agent-session-transfer';
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, max_active_conversations, last_seen_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 'online', 1, 5, CURRENT_TIMESTAMP)`,
    )
    .run('agent-transfer', 'Agent Transfer', 'agent-transfer', 'hash', 'salt');
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    )
    .run(
      'session-standby',
      'agent-standby',
      sha256(standbyToken),
      expiresAt,
      'session-transfer',
      'agent-transfer',
      sha256(transferToken),
      expiresAt,
    );

  const standbyCookie = `cs_agent_session=${standbyToken}`;
  const quickReplyResponse = await agentApi.request(
    '/api/agent/quick-replies',
    {
      method: 'POST',
      headers: { cookie: standbyCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Welcome', body: 'How can I help?' }),
    },
    env,
  );
  assert.equal(quickReplyResponse.status, 201);
  const standbyInbox = await json(
    await agentApi.request(
      '/api/agent/conversations',
      { headers: { cookie: standbyCookie } },
      env,
    ),
  );
  assert.equal(standbyInbox.quickReplies[0].title, 'Welcome');
  assert.ok(
    standbyInbox.transferTargets.some(
      (target) => target.id === 'agent-transfer',
    ),
  );

  const transferResponse = await agentApi.fetch(
    new globalThis.Request(
      `https://customer-service.test/api/agent/conversations/${encodeURIComponent(conversationId)}/transfer`,
      {
        method: 'POST',
        headers: { cookie: standbyCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ targetAgentId: 'agent-transfer' }),
      },
    ),
    env,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
  const transferred = await json(transferResponse);
  assert.equal(transferred.assignment.id, 'agent-transfer');
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(conversationId).assigned_agent,
    'agent-transfer',
  );
  assert.ok(
    (rooms.events.get('agent-inbox:agent-transfer') ?? []).some(
      (event) => event.type === 'conversation.refresh',
    ),
  );

  const requeueResponse = await agentApi.fetch(
    new globalThis.Request(
      `https://customer-service.test/api/agent/conversations/${encodeURIComponent(conversationId)}/transfer`,
      {
        method: 'POST',
        headers: {
          cookie: `cs_agent_session=${transferToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetAgentId: null }),
      },
    ),
    env,
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
  const requeued = await json(requeueResponse);
  assert.equal(requeued.assignment.id, 'agent-standby');

  database.close();
});
