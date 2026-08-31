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
  'no-agent-message.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let clientApi;
let broadcastAssignments;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
  ({ broadcastAssignments } = await import(
    '../src/worker/assignment-broadcast.ts',
  ));
} finally {
  for (const shimPath of shims) unlinkSync(shimPath);
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

function setup() {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled, traffic_quota_total, traffic_quota_used
    ) VALUES (
      'cta-agent', 'default', 'CTA Agent', 'cta-agent', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0
    );
    INSERT INTO product_catalog (
      site_id, id, title, href, cover_url,
      section_id, section_name, category_id, category_name, is_enabled
    ) VALUES (
      'default', 'product-1', 'Product 1',
      '/sections/west/products/product-1/', NULL,
      'west', 'West', 'category-1', 'Category 1', 1
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
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
        product: { id: 'product-1' },
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

test(
  'visitor-facing open conversations remain active and never expose waiting',
  async () => {
    const database = setup();
    const rooms = fakeRooms();
    const started = await startConversation(
      database,
      rooms,
      '11111111-1111-4111-8111-111111111111',
    );
    const startedValue = await started.json();
    assert.equal(started.status, 201);

    database
      .prepare(`UPDATE conversations SET status = 'open' WHERE id = ?`)
      .run(startedValue.conversation.id);

    const detail = await clientApi.request(
      `/client/v1/conversations/${encodeURIComponent(startedValue.conversation.id)}?visitorToken=${encodeURIComponent(startedValue.visitorToken)}`,
      undefined,
      { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
    );
    const detailValue = await detail.json();
    assert.equal(detail.status, 200);
    assert.equal(detailValue.conversation.status, 'active');

    const assignmentAt = new Date().toISOString();
    await broadcastAssignments(
      { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
      'cta-agent',
      [startedValue.conversation.id],
      assignmentAt,
    );
    const assignedEvent = rooms.events
      .filter(
        (event) =>
          event.name === 'client:default:ABC123' &&
          event.payload.type === 'conversation.assigned',
      )
      .at(-1);
    assert.equal(assignedEvent?.payload.conversation.status, 'active');

    database.close();
  },
);

test(
  'later visitor activity cannot resurrect a residual unassigned conversation',
  async () => {
    const database = setup();
    const rooms = fakeRooms();
    const handoff = '22222222-2222-4222-8222-222222222222';
    const started = await startConversation(database, rooms, handoff);
    const startedValue = await started.json();
    assert.equal(started.status, 201);

    database
      .prepare(
        `UPDATE conversations
       SET assigned_agent = NULL, status = 'open'
       WHERE id = ?`,
      )
      .run(startedValue.conversation.id);

    const messageResponse = await clientApi.request(
      `/client/v1/conversations/${encodeURIComponent(startedValue.conversation.id)}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitorToken: startedValue.visitorToken,
          clientMessageId: 'residual-message-1',
          body: 'Hello again',
        }),
      },
      { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
    );
    const messageValue = await messageResponse.json();
    assert.equal(messageResponse.status, 503);
    assert.equal(messageValue.error.code, 'NO_AGENT_AVAILABLE');
    assert.equal(
      scalar(
        database,
        `SELECT assigned_agent FROM conversations WHERE id = ?`,
        'assigned_agent',
        startedValue.conversation.id,
      ),
      null,
    );
    assert.equal(
      scalar(
        database,
        `SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?`,
        'count',
        startedValue.conversation.id,
      ),
      0,
    );

    const detail = await clientApi.request(
      `/client/v1/conversations/${encodeURIComponent(startedValue.conversation.id)}?visitorToken=${encodeURIComponent(startedValue.visitorToken)}`,
      undefined,
      { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
    );
    assert.equal(detail.status, 404);

    const replay = await startConversation(database, rooms, handoff);
    const replayValue = await replay.json();
    assert.equal(replay.status, 503);
    assert.equal(replayValue.error.code, 'NO_AGENT_AVAILABLE');
    assert.equal(
      scalar(
        database,
        `SELECT assigned_agent FROM conversations WHERE id = ?`,
        'assigned_agent',
        startedValue.conversation.id,
      ),
      null,
    );

    database.close();
  },
);
