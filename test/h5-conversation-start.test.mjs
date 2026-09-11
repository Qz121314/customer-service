import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMigrations,
  clientApi,
  DatabaseSync,
} from './helpers/performance-runtime.mjs';

const PRODUCT_ID = 'h5:product:conversation-start';
const POOL_ID = 'h5:pool:conversation-start';
const H5_PRODUCT = {
  id: PRODUCT_ID,
  title: 'H5 Conversation Product',
  sectionId: 'h5:section:pages',
  sectionName: 'H5 页面',
  categoryId: 'h5:category:landing',
  categoryName: 'Landing',
  slug: 'conversation-start',
};

function d1(database, prepared = []) {
  function statement(sql) {
    prepared.push(sql);
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
      database.exec('BEGIN');
      try {
        const results = [];
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

function rooms() {
  return {
    namespace: {
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
    },
  };
}

function seedH5(
  database,
  { pool = POOL_ID, published = true, enabled = true } = {},
) {
  database
    .prepare(
      `INSERT INTO h5_settings (site_id, public_origin)
       VALUES ('default', 'https://h5.example.com')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO h5_conversion_pools (
         site_id, id, name, is_enabled, action_type, cta_label, external_url
       ) VALUES ('default', ?1, 'H5 Chat', 1, 'chat', 'Chat', NULL)`,
    )
    .run(POOL_ID);
  database
    .prepare(
      `INSERT INTO h5_product_catalog (
         site_id, id, title, section_id, section_name,
         category_id, category_name, slug, conversion_pool_id, is_enabled
       ) VALUES ('default', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
    .run(
      H5_PRODUCT.id,
      H5_PRODUCT.title,
      H5_PRODUCT.sectionId,
      H5_PRODUCT.sectionName,
      H5_PRODUCT.categoryId,
      H5_PRODUCT.categoryName,
      H5_PRODUCT.slug,
      pool,
      enabled ? 1 : 0,
    );
  database
    .prepare(
      `INSERT INTO h5_page_content (
         site_id, page_id, published_asset_id, published_byte_size, published_at
       ) VALUES ('default', ?1, ?2, 32, CURRENT_TIMESTAMP)`,
    )
    .run(H5_PRODUCT.id, published ? 'asset-v1' : null);
}

function seedAgent(database, scopeType) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         password_iterations, status, is_enabled, last_seen_at,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used
       ) VALUES ('h5-agent', 'default', 'H5 Agent', 'h5-agent', 'hash', 'salt',
         1000, 'online', 1, CURRENT_TIMESTAMP, 0, 0, 0, 0)`,
    )
    .run();
  const scope = {
    section: ['h5:section:pages', '', ''],
    category: ['h5:section:pages', H5_PRODUCT.categoryId, ''],
    product: ['', '', H5_PRODUCT.id],
  }[scopeType];
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id,
         product_id, is_enabled
       ) VALUES ('default', 'h5-agent', ?1, ?2, ?3, ?4, 1)`,
    )
    .run(scopeType, ...scope);
}

function setup({ scopeType = 'section', ...options } = {}) {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedH5(database, options);
  seedAgent(database, scopeType);
  return database;
}

async function start(database, sourceHandoffId, productId = PRODUCT_ID) {
  return clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId: 'HVC123',
        sourceHandoffId,
        product: { id: productId },
      }),
    },
    { DB: d1(database), CONVERSATION_ROOMS: rooms().namespace },
  );
}

test('H5 Chat starts through the existing conversation and routing pipeline', async () => {
  for (const scopeType of ['product', 'section', 'category']) {
    const database = setup({ scopeType });
    const response = await start(
      database,
      `11111111-1111-4111-8111-11111111111${scopeType.length}`,
    );
    const body = await response.json();
    assert.equal(response.status, 201, scopeType);
    assert.equal(body.conversation.agentName, 'H5 Agent');
    assert.equal(body.conversation.productId, PRODUCT_ID);
    assert.equal(body.conversation.sectionId, H5_PRODUCT.sectionId);
    assert.equal(body.conversation.messages[0].kind, 'product_context');
    assert.equal(
      body.conversation.messages[0].productContext.categoryId,
      H5_PRODUCT.categoryId,
    );
    assert.equal(
      body.conversation.messages[0].productContext.href,
      'https://h5.example.com/conversation-start/',
    );
    assert.equal(
      database.prepare('SELECT product_href FROM conversations LIMIT 1').get()
        .product_href,
      'https://h5.example.com/conversation-start/',
    );
    database.close();
  }
});

test('H5 two-hour reuse does not create a second conversation or charge', async () => {
  const database = setup();
  const first = await start(database, '22222222-2222-4222-8222-222222222222');
  const firstBody = await first.json();
  const second = await start(database, '33333333-3333-4333-8333-333333333333');
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(secondBody.conversation.id, firstBody.conversation.id);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversations').get().count,
    1,
  );
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM agent_traffic_receipts')
      .get().count,
    1,
  );
  database.close();
});

test('H5 no-agent response cleans the temporary start', async () => {
  const database = setup();
  database.prepare('DELETE FROM agent_routing_scopes').run();
  const response = await start(
    database,
    '99999999-9999-4999-8999-999999999999',
  );
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'NO_AGENT_AVAILABLE');
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM conversations').get().count,
    0,
  );
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM conversation_traffic_receipts')
      .get().count,
    0,
  );
  database.close();
});

test('H5 invalid states never create a conversation or traffic', async () => {
  const cases = [
    ['disabled page', { enabled: false }],
    ['unpublished page', { published: false }],
    ['no conversion pool', { pool: null }],
  ];
  for (const [index, [name, options]] of cases.entries()) {
    const database = setup(options);
    const response = await start(
      database,
      `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
    );
    assert.equal(response.status, 404, name);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM conversations').get()
        .count,
      0,
    );
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM agent_traffic_receipts')
        .get().count,
      0,
    );
    database.close();
  }

  const disabledPool = setup();
  disabledPool.prepare('UPDATE h5_conversion_pools SET is_enabled = 0').run();
  const disabledPoolResponse = await start(
    disabledPool,
    '55555555-5555-4555-8555-555555555555',
  );
  assert.equal(disabledPoolResponse.status, 404, 'disabled pool');
  disabledPool.close();

  const externalPool = setup();
  externalPool
    .prepare(
      `UPDATE h5_conversion_pools
       SET action_type = 'external', external_url = 'https://example.com'`,
    )
    .run();
  const externalResponse = await start(
    externalPool,
    '66666666-6666-4666-8666-666666666666',
  );
  assert.equal(externalResponse.status, 404, 'external pool');
  externalPool.close();

  const missing = setup();
  const missingResponse = await start(
    missing,
    '77777777-7777-4777-8777-777777777777',
    'h5:product:missing',
  );
  assert.equal(missingResponse.status, 404, 'missing H5 product');
  assert.equal(
    missing.prepare('SELECT COUNT(*) AS count FROM conversations').get().count,
    0,
  );
  missing.close();
});

test('H5 resolver uses one direct namespace query without Site catalog fallback', async () => {
  const database = setup();
  const prepared = [];
  const response = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId: 'HCC123',
        sourceHandoffId: '88888888-8888-4888-8888-888888888888',
        product: { id: PRODUCT_ID },
      }),
    },
    { DB: d1(database, prepared), CONVERSATION_ROOMS: rooms().namespace },
  );
  assert.equal(response.status, 201);
  assert.equal(
    prepared.filter((sql) => /FROM h5_product_catalog/u.test(sql)).length,
    1,
  );
  assert.equal(
    prepared.filter((sql) => /FROM product_catalog/u.test(sql)).length,
    0,
  );
  database.close();
});
