import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { clientApi } from './helpers/performance-runtime.mjs';

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

function seedAgent(database, id, status = 'online') {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, daily_conversation_limit,
         traffic_quota_enabled, traffic_quota_total, traffic_quota_used
       ) VALUES (?, 'default', ?, ?, 'hash', 'salt', ?, 1,
         CURRENT_TIMESTAMP, 0, 1, 100, 0)`,
    )
    .run(id, id, id, status);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id,
         is_enabled
       ) VALUES ('default', ?, 'section', 'west', '', '', 1)`,
    )
    .run(id);
}

function seedProduct(database, id) {
  database
    .prepare(
      `INSERT INTO product_catalog (
         site_id, id, title, href, cover_url,
         section_id, section_name, category_id, category_name, is_enabled
       ) VALUES ('default', ?, ?, ?, NULL,
         'west', 'West', 'category-1', 'Category 1', 1)`,
    )
    .run(id, id, `https://storefront.example/products/${id}`);
}

function setup() {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedProduct(database, 'product-1');
  seedProduct(database, 'product-2');
  return database;
}

async function startConversation(
  database,
  { visitorId, productId, sourceHandoffId },
) {
  return clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sourceHandoffId,
        product: { id: productId },
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms(),
    },
  );
}

function scalar(database, sql, column, ...bindings) {
  return database.prepare(sql).get(...bindings)[column];
}

test('busy is unavailable for routing and does not fork an active two-hour conversation', async () => {
  const database = setup();
  seedAgent(database, 'agent-a', 'online');

  const first = await startConversation(database, {
    visitorId: 'ABC123',
    productId: 'product-1',
    sourceHandoffId: '10101010-1010-4010-8010-101010101010',
  });
  const firstValue = await first.json();

  database.exec(`UPDATE agents SET status = 'busy' WHERE id = 'agent-a'`);

  const repeated = await startConversation(database, {
    visitorId: 'ABC123',
    productId: 'product-1',
    sourceHandoffId: '20202020-2020-4020-8020-202020202020',
  });
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
      'SELECT assigned_agent FROM conversations WHERE id = ?',
      'assigned_agent',
      firstValue.conversation.id,
    ),
    'agent-a',
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

test('only online agents participate in site-wide round robin across products', async () => {
  const database = setup();
  seedAgent(database, 'agent-a', 'online');
  seedAgent(database, 'agent-b', 'online');

  const first = await startConversation(database, {
    visitorId: 'ABC123',
    productId: 'product-1',
    sourceHandoffId: '30303030-3030-4030-8030-303030303030',
  });
  const second = await startConversation(database, {
    visitorId: 'DEF456',
    productId: 'product-2',
    sourceHandoffId: '40404040-4040-4040-8040-404040404040',
  });
  const third = await startConversation(database, {
    visitorId: 'GHI789',
    productId: 'product-1',
    sourceHandoffId: '50505050-5050-4050-8050-505050505050',
  });

  const [firstValue, secondValue, thirdValue] = await Promise.all([
    first.json(),
    second.json(),
    third.json(),
  ]);

  assert.deepEqual(
    [first.status, second.status, third.status],
    [201, 201, 201],
  );
  assert.deepEqual(
    [
      firstValue.conversation.agentName,
      secondValue.conversation.agentName,
      thirdValue.conversation.agentName,
    ],
    ['agent-a', 'agent-b', 'agent-a'],
  );

  database.exec(`UPDATE agents SET status = 'busy' WHERE id = 'agent-a'`);
  const fourth = await startConversation(database, {
    visitorId: 'JKL012',
    productId: 'product-2',
    sourceHandoffId: '60606060-6060-4060-8060-606060606060',
  });
  const fourthValue = await fourth.json();
  assert.equal(fourth.status, 201);
  assert.equal(fourthValue.conversation.agentName, 'agent-b');

  database.exec(`UPDATE agents SET status = 'offline' WHERE id = 'agent-b'`);
  const fifth = await startConversation(database, {
    visitorId: 'MNO345',
    productId: 'product-1',
    sourceHandoffId: '70707070-7070-4070-8070-707070707070',
  });
  const fifthValue = await fifth.json();
  assert.equal(fifth.status, 503);
  assert.equal(fifthValue.error.code, 'NO_AGENT_AVAILABLE');

  database.close();
});
