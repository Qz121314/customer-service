import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const moduleShims = [];
for (const name of readdirSync(workerDirectory)) {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  moduleShims.push(shimPath);
}

let agentApi;
let clientApi;
try {
  [{ agentApi }, { clientApi }] = await Promise.all([
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
      body: JSON.stringify({ body: 'Hello from agent' }),
    },
    env,
  );
  assert.equal(replyResponse.status, 201);
  const reply = await json(replyResponse);
  assert.equal(reply.message.sender_type, 'agent');
  assert.equal(reply.message.body, 'Hello from agent');

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
  const inboxEvents = rooms.events.get('admin-inbox') ?? [];
  assert.ok(
    inboxEvents.some(
      (event) =>
        event.type === 'conversation.changed' &&
        event.conversation?.id === conversationId,
    ),
  );

  database.close();
});
