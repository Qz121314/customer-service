import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMigrations,
  clientApi,
  createInstrumentedD1,
  DatabaseSync,
  fakeRooms,
} from './helpers/performance-runtime.mjs';

function seedProduct(database, id = 'product-1') {
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

function seedAgent(database, id, status = 'online') {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, daily_conversation_limit,
         traffic_quota_enabled, traffic_quota_total, traffic_quota_used
       ) VALUES (?, 'default', ?, ?, 'hash', 'salt', ?, 1,
         CURRENT_TIMESTAMP, 0, 0, 0, 0)`,
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

function setup() {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedProduct(database);
  return database;
}

function handoffId(index) {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

async function startConversation(
  db,
  rooms,
  index,
  visitorId,
  productId = 'product-1',
) {
  const response = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sourceHandoffId: handoffId(index),
        product: { id: productId },
      }),
    },
    {
      DB: db,
      CONVERSATION_ROOMS: rooms,
    },
  );
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  return payload.conversation;
}

test(
  'three equally eligible agents receive 300 normal conversations exactly evenly',
  async () => {
    const database = setup();
    seedAgent(database, 'agent-a');
    seedAgent(database, 'agent-b');
    seedAgent(database, 'agent-c');
    const instrumented = createInstrumentedD1(database);
    const rooms = fakeRooms().namespace;

    for (let index = 1; index <= 300; index += 1) {
      await startConversation(
        instrumented.db,
        rooms,
        index,
        `VIS${index.toString().padStart(4, '0')}`,
      );
    }

    const rows = database
      .prepare(
        `SELECT assigned_agent AS agent_id, COUNT(*) AS count
       FROM conversations
       GROUP BY assigned_agent
       ORDER BY assigned_agent ASC`,
      )
      .all();
    assert.deepEqual(rows, [
      { agent_id: 'agent-a', count: 100 },
      { agent_id: 'agent-b', count: 100 },
      { agent_id: 'agent-c', count: 100 },
    ]);

    const reasons = database
      .prepare(
        `SELECT assignment_reason, COUNT(*) AS count
       FROM conversations
       GROUP BY assignment_reason`,
      )
      .all();
    assert.deepEqual(reasons, [
      { assignment_reason: 'round_robin', count: 300 },
    ]);

    database.close();
  },
);

test(
  'CTA affinity does not consume or move the next normal round-robin turn',
  async () => {
    const database = setup();
    seedAgent(database, 'agent-a');
    seedAgent(database, 'agent-b');
    seedAgent(database, 'agent-c');
    const instrumented = createInstrumentedD1(database);
    const rooms = fakeRooms().namespace;

    const first = await startConversation(
      instrumented.db,
      rooms,
      1001,
      'RETURNING_VISITOR',
    );
    assert.equal(first.agentName, 'agent-a');
    database
      .prepare(
        `UPDATE conversations
       SET status = 'closed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      )
      .run(first.id);

    const second = await startConversation(
      instrumented.db,
      rooms,
      1002,
      'OTHER_VISITOR_1',
    );
    assert.equal(second.agentName, 'agent-b');

    const affinity = await startConversation(
      instrumented.db,
      rooms,
      1003,
      'RETURNING_VISITOR',
    );
    assert.equal(affinity.agentName, 'agent-a');
    assert.equal(
      database
        .prepare('SELECT assignment_reason FROM conversations WHERE id = ?')
        .get(affinity.id).assignment_reason,
      'affinity',
    );

    const cursorAfterAffinity = database
      .prepare(
        `SELECT last_agent_id
       FROM routing_round_robin_cursors
       WHERE site_id = 'default'`,
      )
      .get();
    assert.equal(cursorAfterAffinity.last_agent_id, 'agent-b');

    const nextNormal = await startConversation(
      instrumented.db,
      rooms,
      1004,
      'OTHER_VISITOR_2',
    );
    assert.equal(nextNormal.agentName, 'agent-c');
    assert.equal(
      database
        .prepare('SELECT assignment_reason FROM conversations WHERE id = ?')
        .get(nextNormal.id).assignment_reason,
      'round_robin',
    );

    const receiptReasons = database
      .prepare(
        `SELECT conversation_id, assignment_reason
       FROM conversation_traffic_receipts
       WHERE conversation_id IN (?, ?)
       ORDER BY conversation_id ASC`,
      )
      .all(affinity.id, nextNormal.id);
    assert.deepEqual(
      new Map(
        receiptReasons.map((row) => [
          row.conversation_id,
          row.assignment_reason,
        ]),
      ),
      new Map([
        [affinity.id, 'affinity'],
        [nextNormal.id, 'round_robin'],
      ]),
    );

    database.close();
  },
);

test('busy agent is skipped and rejoins without catch-up priority', async () => {
  const database = setup();
  seedAgent(database, 'agent-a');
  seedAgent(database, 'agent-b');
  seedAgent(database, 'agent-c');
  const instrumented = createInstrumentedD1(database);
  const rooms = fakeRooms().namespace;

  const first = await startConversation(
    instrumented.db,
    rooms,
    2001,
    'BUSY_A',
  );
  assert.equal(first.agentName, 'agent-a');

  database.exec(`UPDATE agents SET status = 'busy' WHERE id = 'agent-b'`);
  const second = await startConversation(
    instrumented.db,
    rooms,
    2002,
    'BUSY_B',
  );
  assert.equal(second.agentName, 'agent-c');

  database.exec(`UPDATE agents SET status = 'online' WHERE id = 'agent-b'`);
  const third = await startConversation(
    instrumented.db,
    rooms,
    2003,
    'BUSY_C',
  );
  assert.equal(third.agentName, 'agent-a');
  const fourth = await startConversation(
    instrumented.db,
    rooms,
    2004,
    'BUSY_D',
  );
  assert.equal(fourth.agentName, 'agent-b');

  database.close();
});
