import assert from 'node:assert/strict';
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
const shims = [];
for (const name of [
  'conversation-retention.ts',
  'routing.ts',
  'assignment-broadcast.ts',
  'abuse-control.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let clientApi;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
} finally {
  for (const shimPath of shims) unlinkSync(shimPath);
}

const product = {
  id: 'product-1',
  sectionId: 'west',
  sectionName: 'West',
  categoryId: 'category-1',
  categoryName: 'Category 1',
  title: 'Product 1',
  href: '/sections/west/products/product-1/',
  coverUrl: null,
};

const otherwiseValidBody = {
  visitorId: 'ABC123',
  clientMessageId: 'message-1',
  message: 'Hello',
  product,
};

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
        const value = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || value === null) return value;
        return value[column] ?? null;
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
  const events = [];
  return {
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            events.push({
              name,
              payload: JSON.parse(String(init?.body ?? '{}')),
            });
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
}

function setup({ greetingEnabled, greetingText = null }) {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, max_active_conversations,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used,
         auto_greeting_enabled, auto_greeting_text
       ) VALUES (
         'cta-agent', 'default', 'CTA Agent', 'cta-agent', 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0,
         0, 1, 10, 0, ?, ?
       )`,
    )
    .run(greetingEnabled ? 1 : 0, greetingText);
  database.exec(`
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', 'cta-agent', 'section', 'west', '', '', 1);
  `);
  return database;
}

async function startConversation(database, rooms, sourceHandoffId) {
  return clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId: 'ABC123',
        sourceHandoffId,
        product,
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: rooms.namespace,
    },
  );
}

function scalar(database, sql, column, ...bindings) {
  return database.prepare(sql).get(...bindings)[column];
}

test('new conversations require a UUID v4 source handoff id before any D1 work', async () => {
  for (const sourceHandoffId of [undefined, '', 'not-a-handoff-id']) {
    const response = await clientApi.request('/client/v1/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...otherwiseValidBody, sourceHandoffId }),
    });
    const value = await response.json();
    assert.equal(response.status, 400);
    assert.equal(value.error.code, 'INVALID_SOURCE_HANDOFF_ID');
  }
});

test('CTA starts an assigned conversation without requiring a visitor message', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const handoff = '11111111-1111-4111-8111-111111111111';

  const response = await startConversation(database, rooms, handoff);
  const value = await response.json();

  assert.equal(response.status, 201);
  assert.equal(value.conversation.status, 'active');
  assert.equal(value.conversation.agentName, 'CTA Agent');
  assert.deepEqual(value.conversation.messages, []);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?`,
      'count',
      value.conversation.id,
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used FROM agents WHERE id = 'cta-agent'`,
      'traffic_quota_used',
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT agent_unread_count FROM conversations WHERE id = ?`,
      'agent_unread_count',
      value.conversation.id,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT outcome FROM conversation_automation_receipts
       WHERE conversation_id = ? AND automation_key = 'initial_greeting'`,
      'outcome',
      value.conversation.id,
    ),
    'skipped',
  );
  assert.ok(
    rooms.events.some(
      (event) =>
        event.name === 'agent-inbox:cta-agent' &&
        event.payload.type === 'conversation.changed' &&
        event.payload.cause === 'initial_assignment' &&
        event.payload.conversation.agent_unread_count === 1,
    ),
  );

  database.close();
});

test('configured greeting is returned immediately from the same CTA start request', async () => {
  const database = setup({
    greetingEnabled: true,
    greetingText: '您好，我来为您服务。',
  });
  const rooms = fakeRooms();
  const handoff = '22222222-2222-4222-8222-222222222222';

  const response = await startConversation(database, rooms, handoff);
  const value = await response.json();

  assert.equal(response.status, 201);
  assert.equal(value.conversation.messages.length, 1);
  assert.equal(value.conversation.messages[0].direction, 'agent');
  assert.equal(value.conversation.messages[0].body, '您好，我来为您服务。');
  assert.equal(value.conversation.unreadCount, 1);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?`,
      'count',
      value.conversation.id,
    ),
    1,
  );
  assert.ok(
    rooms.events.some(
      (event) =>
        event.name === `client:default:ABC123` &&
        event.payload.type === 'message.created' &&
        event.payload.message?.body === '您好，我来为您服务。',
    ),
  );

  const replay = await startConversation(database, rooms, handoff);
  const replayValue = await replay.json();
  assert.equal(replay.status, 200);
  assert.equal(replayValue.conversation.id, value.conversation.id);
  assert.equal(replayValue.conversation.messages.length, 1);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count FROM agent_traffic_receipts WHERE conversation_id = ?`,
      'count',
      value.conversation.id,
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used FROM agents WHERE id = 'cta-agent'`,
      'traffic_quota_used',
    ),
    1,
  );

  database.close();
});
