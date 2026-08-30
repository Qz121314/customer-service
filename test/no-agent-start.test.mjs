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
  'site-settings.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let clientApi;
let rejectUnassignedConversationStart;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
  ({ rejectUnassignedConversationStart } = await import(
    '../src/worker/no-agent-start.ts'
  ));
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
  return {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          return new Response(null, { status: 204 });
        },
      };
    },
  };
}

async function startWithoutAgent(database, sourceHandoffId) {
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms(),
  };
  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'no-agent-start-test',
      'cf-connecting-ip': '203.0.113.10',
    },
    body: JSON.stringify({
      visitorId: 'ABC123',
      sourceHandoffId,
      product,
    }),
  };
  const response = await clientApi.request(
    '/client/v1/conversations',
    init,
    env,
  );
  const sourceRequest = new Request(
    'https://customer-service.test/client/v1/conversations',
    init,
  );
  return rejectUnassignedConversationStart(sourceRequest, env, response);
}

function scalar(database, sql, column) {
  return Number(database.prepare(sql).get()[column]);
}

test('no eligible agent returns configured 503 and leaves no waiting or creation quota', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database
    .prepare(`UPDATE sites SET no_agent_message = ? WHERE id = 'default'`)
    .run('当前为非营业时间，请明天 9:00 后再试。');

  const response = await startWithoutAgent(
    database,
    '11111111-1111-4111-8111-111111111111',
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: {
      code: 'NO_AGENT_AVAILABLE',
      message: '当前为非营业时间，请明天 9:00 后再试。',
    },
  });

  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
    0,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COUNT(*) AS count FROM conversation_source_handoffs',
      'count',
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COUNT(*) AS count FROM conversation_creation_quota_receipts',
      'count',
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COALESCE(SUM(accepted_count), 0) AS count FROM conversation_creation_limits',
      'count',
    ),
    0,
  );
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM visitors', 'count'),
    0,
  );
});

test('assigned consultation remains successful and keeps its creation quota', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled, traffic_quota_total, traffic_quota_used
    ) VALUES (
      'agent-a', 'default', 'Agent A', 'agent-a', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 0, 0, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', 'agent-a', 'section', 'west', '', '', 1);
  `);

  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms(),
  };
  const init = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'no-agent-start-test',
      'cf-connecting-ip': '203.0.113.11',
    },
    body: JSON.stringify({
      visitorId: 'ABC123',
      sourceHandoffId: '22222222-2222-4222-8222-222222222222',
      product,
    }),
  };
  const response = await clientApi.request(
    '/client/v1/conversations',
    init,
    env,
  );
  const checked = await rejectUnassignedConversationStart(
    new Request(
      'https://customer-service.test/client/v1/conversations',
      init,
    ),
    env,
    response,
  );

  assert.equal(checked.status, 201);
  const body = await checked.json();
  assert.equal(body.conversation.status, 'active');
  assert.equal(body.conversation.agentName, 'Agent A');
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
    1,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COUNT(*) AS count FROM conversation_creation_quota_receipts',
      'count',
    ),
    1,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COALESCE(SUM(accepted_count), 0) AS count FROM conversation_creation_limits',
      'count',
    ),
    2,
  );
});
