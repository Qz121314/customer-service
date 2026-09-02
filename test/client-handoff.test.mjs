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
  'message-attachments.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let clientApi;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
} catch (error) {
  for (const shimPath of shims) unlinkSync(shimPath);
  throw error;
}
process.once('exit', () => {
  for (const shimPath of shims) {
    if (existsSync(shimPath)) unlinkSync(shimPath);
  }
});

const product = {
  id: 'product-1',
  sectionId: 'west',
  sectionName: 'West',
  categoryId: 'category-1',
  categoryName: 'Category 1',
  title: 'Product 1',
  href: 'https://storefront.example/sections/west/products/product-1/',
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

function fakeRooms({ failName = null } = {}) {
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
            if (name === failName) throw new Error('room unavailable');
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
         status, is_enabled, last_seen_at, daily_conversation_limit,
         traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used,
         auto_greeting_enabled, auto_greeting_text
       ) VALUES (
         'cta-agent', 'default', 'CTA Agent', 'cta-agent', 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0, ?, ?
       )`,
    )
    .run(greetingEnabled ? 1 : 0, greetingText);
  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, href, cover_url,
      section_id, section_name, category_id, category_name, is_enabled
    ) VALUES (
      'default', 'product-1', 'Product 1',
      'https://storefront.example/sections/west/products/product-1/', NULL,
      'west', 'West', 'category-1', 'Category 1', 1
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', 'cta-agent', 'section', 'west', '', '', 1);
  `);
  return database;
}

async function startConversation(
  database,
  rooms,
  sourceHandoffId,
  overrides = {},
) {
  const selectedProduct = overrides.product ?? product;
  database
    .prepare(
      `INSERT OR IGNORE INTO product_catalog (
         site_id, id, title, href, cover_url,
         section_id, section_name, category_id, category_name, is_enabled
       ) VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      selectedProduct.id,
      selectedProduct.title,
      selectedProduct.href,
      selectedProduct.coverUrl,
      selectedProduct.sectionId,
      selectedProduct.sectionName,
      selectedProduct.categoryId,
      selectedProduct.categoryName,
    );
  return clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId: overrides.visitorId ?? 'ABC123',
        ...(overrides.visitorToken
          ? { visitorToken: overrides.visitorToken }
          : {}),
        sourceHandoffId,
        product: selectedProduct,
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: rooms.namespace,
    },
  );
}

test('visitor product fields cannot override the Site-synchronized catalog', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const response = await startConversation(
    database,
    rooms,
    '12121212-1212-4121-8121-121212121212',
    {
      product: {
        ...product,
        sectionId: 'east',
        sectionName: 'East',
        title: 'Forged Product',
        href: 'https://storefront.example/forged',
      },
    },
  );
  const value = await response.json();

  assert.equal(response.status, 201);
  assert.equal(value.conversation.productTitle, 'Product 1');
  assert.equal(value.conversation.sectionId, 'west');
  assert.equal(
    scalar(
      database,
      `SELECT section_id FROM product_catalog
       WHERE site_id = 'default' AND id = 'product-1'`,
      'section_id',
    ),
    'west',
  );
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count FROM conversations
       WHERE product_id = 'product-1'`,
      'count',
    ),
    1,
  );
  database.close();
});

test('disabled products cannot start a visitor conversation', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  database
    .prepare(
      `UPDATE product_catalog
       SET is_enabled = 0
       WHERE site_id = 'default' AND id = 'product-1'`,
    )
    .run();

  const response = await startConversation(
    database,
    rooms,
    '13131313-1313-4131-8131-131313131313',
  );
  const value = await response.json();

  assert.equal(response.status, 404);
  assert.equal(value.error.code, 'PRODUCT_NOT_FOUND');
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
    0,
  );
  database.close();
});

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
  assert.equal(typeof value.visitorToken, 'string');
  assert.ok(value.visitorToken.length >= 32);
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

test('visitor access token can replace the short visitor id for reads', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const response = await startConversation(
    database,
    rooms,
    '15151515-1515-4515-8515-151515151515',
  );
  const value = await response.json();
  const token = value.visitorToken;

  const listResponse = await clientApi.request(
    `/client/v1/conversations?visitorToken=${encodeURIComponent(token)}`,
    undefined,
    { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
  );
  const detailResponse = await clientApi.request(
    `/client/v1/conversations/${encodeURIComponent(value.conversation.id)}?visitorToken=${encodeURIComponent(token)}`,
    undefined,
    { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
  );
  const invalidResponse = await clientApi.request(
    `/client/v1/conversations/${encodeURIComponent(value.conversation.id)}?visitorId=ABC123&visitorToken=${encodeURIComponent(`${token}x`)}`,
    undefined,
    { DB: d1(database), CONVERSATION_ROOMS: rooms.namespace },
  );

  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).conversations.length, 1);
  assert.equal(detailResponse.status, 200);
  assert.equal(
    (await detailResponse.json()).conversation.id,
    value.conversation.id,
  );
  assert.equal(invalidResponse.status, 401);
  assert.equal(
    (await invalidResponse.json()).error.code,
    'INVALID_VISITOR_TOKEN',
  );
  assert.equal(
    scalar(
      database,
      `SELECT access_token_hash IS NOT NULL AS present
       FROM visitors WHERE external_id = 'ABC123'`,
      'present',
    ),
    1,
  );
  database.close();
});

test('concurrent CTA starts coalesce into one conversation and one quota receipt', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const responses = await Promise.all([
    startConversation(database, rooms, '16161616-1616-4616-8616-161616161616'),
    startConversation(database, rooms, '17171717-1717-4717-8717-171717171717'),
  ]);
  const values = await Promise.all(
    responses.map((response) => response.json()),
  );

  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 201],
  );
  assert.equal(new Set(values.map((value) => value.conversation.id)).size, 1);
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
      'SELECT COUNT(*) AS count FROM conversation_source_handoffs',
      'count',
    ),
    2,
  );
  database.close();
});

test('concurrent no-agent starts leave no reusable claim or handoff', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  database.exec(`UPDATE agents SET status = 'offline' WHERE id = 'cta-agent'`);

  const responses = await Promise.all([
    startConversation(database, rooms, '20202020-2020-4020-8020-202020202020'),
    startConversation(database, rooms, '21212121-2121-4121-8121-212121212121'),
  ]);
  const values = await Promise.all(
    responses.map((response) => response.json()),
  );

  assert.deepEqual(
    responses.map((response) => response.status),
    [503, 503],
  );
  assert.deepEqual(
    values.map((value) => value.error.code),
    ['NO_AGENT_AVAILABLE', 'NO_AGENT_AVAILABLE'],
  );
  for (const table of [
    'conversations',
    'conversation_creation_quota_receipts',
    'conversation_source_handoffs',
    'conversation_traffic_receipts',
  ]) {
    assert.equal(
      scalar(database, `SELECT COUNT(*) AS count FROM ${table}`, 'count'),
      0,
      `${table} must not retain a no-agent claim`,
    );
  }
  database.close();
});

test('assignment delivery failure does not turn a committed CTA into an error', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms({ failName: 'agent-inbox:cta-agent' });
  const response = await startConversation(
    database,
    rooms,
    '18181818-1818-4818-8818-181818181818',
  );
  const value = await response.json();

  assert.equal(response.status, 201);
  assert.equal(value.conversation.agentName, 'CTA Agent');
  assert.equal(
    scalar(
      database,
      `SELECT assigned_agent FROM conversations WHERE id = ?`,
      'assigned_agent',
      value.conversation.id,
    ),
    'cta-agent',
  );
  database.close();
});

test('same visitor and product reuse one assigned conversation for two hours', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();

  const first = await startConversation(
    database,
    rooms,
    '33333333-3333-4333-8333-333333333333',
  );
  const firstValue = await first.json();
  database.exec(`
    UPDATE agents
    SET last_seen_at = datetime('now', '-30 days')
    WHERE id = 'cta-agent';
  `);
  const repeated = await startConversation(
    database,
    rooms,
    '44444444-4444-4444-8444-444444444444',
  );
  const repeatedValue = await repeated.json();

  assert.equal(first.status, 201);
  assert.equal(repeated.status, 200);
  assert.equal(repeatedValue.conversation.id, firstValue.conversation.id);
  assert.equal(repeatedValue.conversation.agentName, 'CTA Agent');
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
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
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count
       FROM conversation_source_handoffs
       WHERE conversation_id = ?`,
      'count',
      firstValue.conversation.id,
    ),
    2,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COUNT(*) AS count FROM conversation_creation_quota_receipts',
      'count',
    ),
    1,
  );

  database.close();
});

test('different products keep independent conversations', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const otherProduct = {
    ...product,
    id: 'product-2',
    title: 'Product 2',
    href: 'https://storefront.example/sections/west/products/product-2/',
  };

  const first = await startConversation(
    database,
    rooms,
    '55555555-5555-4555-8555-555555555555',
  );
  const firstValue = await first.json();
  const second = await startConversation(
    database,
    rooms,
    '66666666-6666-4666-8666-666666666666',
    { product: otherProduct },
  );
  const secondValue = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.notEqual(secondValue.conversation.id, firstValue.conversation.id);
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
    2,
  );

  database.close();
});

test('a fresh closed conversation prefers its original eligible agent', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const first = await startConversation(
    database,
    rooms,
    '77777777-7777-4777-8777-777777777777',
  );
  const firstValue = await first.json();

  database
    .prepare(`UPDATE conversations SET status = 'closed' WHERE id = ?`)
    .run(firstValue.conversation.id);
  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled,
      traffic_quota_total, traffic_quota_used
    ) VALUES (
      'aaa-agent', 'default', 'AAA Agent', 'aaa-agent', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES ('default', 'aaa-agent', 'section', 'west', '', '', 1);
  `);

  const second = await startConversation(
    database,
    rooms,
    '88888888-8888-4888-8888-888888888888',
  );
  const secondValue = await second.json();

  assert.equal(second.status, 201);
  assert.notEqual(secondValue.conversation.id, firstValue.conversation.id);
  assert.equal(secondValue.conversation.agentName, 'CTA Agent');
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used FROM agents WHERE id = 'cta-agent'`,
      'traffic_quota_used',
    ),
    2,
  );
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used FROM agents WHERE id = 'aaa-agent'`,
      'traffic_quota_used',
    ),
    0,
  );

  database.close();
});

test('an active conversation returns no-agent when its owner is offline', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const first = await startConversation(
    database,
    rooms,
    'abababab-abab-4aba-8aba-abababababab',
  );
  const firstValue = await first.json();

  database.exec(`
    UPDATE agents
    SET status = 'offline'
    WHERE id = 'cta-agent';

    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled,
      traffic_quota_total, traffic_quota_used
    ) VALUES (
      'aaa-agent', 'default', 'AAA Agent', 'aaa-agent', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES ('default', 'aaa-agent', 'section', 'west', '', '', 1);
  `);

  const repeated = await startConversation(
    database,
    rooms,
    'acacacac-acac-4aca-8aca-acacacacacac',
  );
  const repeatedValue = await repeated.json();

  assert.equal(first.status, 201);
  assert.equal(repeated.status, 503);
  assert.equal(repeatedValue.error.code, 'NO_AGENT_AVAILABLE');
  assert.equal(
    scalar(database, 'SELECT COUNT(*) AS count FROM conversations', 'count'),
    1,
  );
  assert.equal(
    scalar(
      database,
      `SELECT assigned_agent FROM conversations WHERE id = ?`,
      'assigned_agent',
      firstValue.conversation.id,
    ),
    'cta-agent',
  );
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used FROM agents WHERE id = 'aaa-agent'`,
      'traffic_quota_used',
    ),
    0,
  );
  assert.equal(
    scalar(
      database,
      'SELECT COUNT(*) AS count FROM conversation_creation_quota_receipts',
      'count',
    ),
    1,
  );

  database.close();
});

test('closed affinity falls back when the original agent is offline', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const first = await startConversation(
    database,
    rooms,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  );
  const firstValue = await first.json();

  database
    .prepare(`UPDATE conversations SET status = 'closed' WHERE id = ?`)
    .run(firstValue.conversation.id);
  database.exec(`
    UPDATE agents
    SET status = 'offline'
    WHERE id = 'cta-agent';

    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled,
      traffic_quota_total, traffic_quota_used
    ) VALUES (
      'aaa-agent', 'default', 'AAA Agent', 'aaa-agent', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES ('default', 'aaa-agent', 'section', 'west', '', '', 1);
  `);

  const second = await startConversation(
    database,
    rooms,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  );
  const secondValue = await second.json();
  const secondRow = database
    .prepare(
      `SELECT assigned_agent, cta_affinity_agent_id
       FROM conversations
       WHERE id = ?`,
    )
    .get(secondValue.conversation.id);

  assert.equal(second.status, 201);
  assert.equal(secondValue.conversation.status, 'active');
  assert.equal(secondValue.conversation.agentName, 'AAA Agent');
  assert.equal(secondRow.assigned_agent, 'aaa-agent');
  assert.equal(secondRow.cta_affinity_agent_id, 'cta-agent');
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
      `SELECT traffic_quota_used FROM agents WHERE id = 'aaa-agent'`,
      'traffic_quota_used',
    ),
    1,
  );

  database.close();
});

test('after two hours a fresh start returns to normal routing', async () => {
  const database = setup({ greetingEnabled: false });
  const rooms = fakeRooms();
  const first = await startConversation(
    database,
    rooms,
    '99999999-9999-4999-8999-999999999999',
  );
  const firstValue = await first.json();

  database
    .prepare(
      `UPDATE conversations
       SET last_message_at = datetime('now', '-3 hours')
       WHERE id = ?`,
    )
    .run(firstValue.conversation.id);
  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled,
      traffic_quota_total, traffic_quota_used
    ) VALUES (
      'aaa-agent', 'default', 'AAA Agent', 'aaa-agent', 'hash', 'salt',
      'online', 1, CURRENT_TIMESTAMP, 0, 1, 10, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES ('default', 'aaa-agent', 'section', 'west', '', '', 1);
  `);

  const second = await startConversation(
    database,
    rooms,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  );
  const secondValue = await second.json();

  assert.equal(second.status, 201);
  assert.notEqual(secondValue.conversation.id, firstValue.conversation.id);
  assert.equal(secondValue.conversation.agentName, 'AAA Agent');

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
