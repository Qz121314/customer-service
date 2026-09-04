import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyMigrations,
  changedRows,
  clientApi,
  createExecutionContext,
  createInstrumentedD1,
  DatabaseSync,
  executionsMatching,
  fakeRooms,
} from './helpers/performance-runtime.mjs';

const PRODUCT_ID = 'product-create-cost';
const FIRST_HANDOFF = '018f47c2-6c72-4d8a-9f11-4b0db21c7358';
const SECOND_HANDOFF = '118f47c2-6c72-4d8a-9f11-4b0db21c7358';
const THIRD_HANDOFF = '218f47c2-6c72-4d8a-9f11-4b0db21c7358';
const FOURTH_HANDOFF = '318f47c2-6c72-4d8a-9f11-4b0db21c7358';

function createFixture(agentIds = ['agent-create-cost-a']) {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database
    .prepare(
      `INSERT INTO product_catalog (
         site_id, id, title, href, section_id, section_name,
         category_id, category_name, is_enabled
       ) VALUES ('default', ?1, 'Create Cost Product',
         'https://storefront.example/sections/west/products/create-cost/',
         'west', 'West', 'massage', 'Massage', 1)`,
    )
    .run(PRODUCT_ID);
  for (const agentId of agentIds) seedEligibleAgent(database, agentId);
  const instrumentation = createInstrumentedD1(database);
  return { database, instrumentation };
}

function seedEligibleAgent(database, agentId) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         password_iterations, status, is_enabled, last_seen_at,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used
       ) VALUES (?1, 'default', ?2, ?3, 'test-password-hash',
         'test-password-salt', 1000, 'online', 1, CURRENT_TIMESTAMP,
         0, 0, 0, 0)`,
    )
    .run(agentId, `Agent ${agentId}`, agentId);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id,
         product_id, is_enabled
       ) VALUES ('default', ?1, 'section', 'west', '', '', 1)`,
    )
    .run(agentId);
}

function seedVisitor(database, visitorId) {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `INSERT INTO visitors (
         id, site_id, external_id, token_hash, access_token_hash,
         display_name, expires_at
       ) VALUES (?1, 'default', ?2, ?3, ?3, 'Create Cost Visitor', ?4)`,
    )
    .run(`visitor-${visitorId}`, visitorId, `token-${visitorId}`, expiresAt);
}

function createRequest({
  visitorId,
  sourceHandoffId,
  clientMessageId,
  message,
}) {
  const body = {
    visitorId,
    projectId: 'default',
    sourceHandoffId,
    product: { id: PRODUCT_ID },
  };
  if (clientMessageId !== undefined) body.clientMessageId = clientMessageId;
  if (message !== undefined) body.message = message;
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'conversation-create-cost-test',
    },
    body: JSON.stringify(body),
  };
}

async function startConversation(
  instrumentation,
  rooms,
  input,
  execution = createExecutionContext(),
) {
  const response = await clientApi.request(
    '/client/v1/conversations',
    createRequest(input),
    {
      DB: instrumentation.db,
      CONVERSATION_ROOMS: rooms.namespace,
    },
    execution.context,
  );
  return { response, execution };
}

function replayQueries(metrics) {
  return executionsMatching(metrics, /WITH message_match AS/iu, 'SELECT');
}

function conversationCreates(metrics) {
  return executionsMatching(
    metrics,
    /INSERT OR IGNORE INTO conversations\b/iu,
    'INSERT',
  );
}

function handoffClaims(metrics) {
  return executionsMatching(
    metrics,
    /INSERT OR IGNORE INTO conversation_source_handoffs\b/iu,
    'INSERT',
  );
}

function handoffOwnerReads(metrics) {
  return executionsMatching(
    metrics,
    /SELECT conversationId, externalId[\s\S]*FROM \(\s*SELECT h\.conversation_id/iu,
    'SELECT',
  );
}

function assignmentWrites(metrics) {
  return executionsMatching(
    metrics,
    /SET assigned_agent = \(SELECT id FROM candidate\)/iu,
    'UPDATE',
  );
}

function routingFallbackReads(metrics) {
  return executionsMatching(
    metrics,
    /SELECT a\.id, a\.name, c\.assigned_at/iu,
    'SELECT',
  );
}

function quotaExecutions(metrics) {
  return executionsMatching(
    metrics,
    /conversation_creation_(?:limits|quota_receipts)/iu,
  );
}

function messageInserts(metrics) {
  return executionsMatching(
    metrics,
    /\bINSERT(?: OR IGNORE)? INTO messages\b/iu,
    'INSERT',
  );
}

function ownedConversationReads(metrics) {
  return executionsMatching(
    metrics,
    /WHERE c\.id = \?1 AND c\.site_id = \?2 AND v\.external_id = \?3/iu,
    'SELECT',
  );
}

function assertMetricIntegrity(metrics) {
  assert.equal(metrics.executed, metrics.first + metrics.all + metrics.run);
  assert.equal(
    metrics.executed,
    metrics.select + metrics.insert + metrics.update + metrics.delete,
  );
  assert.equal(metrics.prepare, metrics.executed);
}

function count(database, table, where = '') {
  return database
    .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
    .get().count;
}

test('first CTA executes the bounded create, claim and assignment lifecycle', async () => {
  const { database, instrumentation } = createFixture();
  const rooms = fakeRooms();
  const { response, execution } = await startConversation(
    instrumentation,
    rooms,
    {
      visitorId: 'CTA101',
      sourceHandoffId: FIRST_HANDOFF,
      clientMessageId: 'create-first-message-1',
      message: 'First CTA message',
    },
  );
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.conversation.agentName, 'Agent agent-create-cost-a');
  assert.equal(body.conversation.messages.length, 1);
  assert.equal(execution.tasks.length, 0);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.equal(metrics.executed, 15);
  assert.equal(metrics.select, 7);
  assert.equal(metrics.insert, 6);
  assert.equal(metrics.update, 2);
  assert.equal(metrics.delete, 0);
  assert.equal(metrics.batch, 2);
  assert.equal(metrics.batchStatements, 4);
  assert.deepEqual(metrics.batchSizes, [2, 2]);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(conversationCreates(metrics).length, 1);
  assert.equal(changedRows(conversationCreates(metrics)), 1);
  assert.equal(handoffClaims(metrics).length, 1);
  assert.equal(changedRows(handoffClaims(metrics)), 1);
  assert.equal(handoffOwnerReads(metrics).length, 0);
  assert.equal(assignmentWrites(metrics).length, 1);
  assert.equal(changedRows(assignmentWrites(metrics)), 1);
  assert.equal(routingFallbackReads(metrics).length, 0);
  assert.equal(ownedConversationReads(metrics).length, 0);
  assert.equal(messageInserts(metrics).length, 1);
  assert.equal(changedRows(messageInserts(metrics)), 1);
  assert.equal(rooms.calls.length, 4);

  assert.equal(count(database, 'conversations'), 1);
  assert.equal(count(database, 'conversation_source_handoffs'), 1);
  assert.equal(count(database, 'messages'), 1);
  assert.equal(count(database, 'agent_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_creation_quota_receipts'), 1);
  assert.deepEqual(
    database
      .prepare(
        `SELECT accepted_count FROM conversation_creation_limits
         ORDER BY subject_key`,
      )
      .all()
      .map((row) => row.accepted_count),
    [1, 1],
  );
  database.close();
});

test('sourceHandoff replay avoids duplicate conversation, assignment, quota and stats', async () => {
  const { database, instrumentation } = createFixture();
  const firstRooms = fakeRooms();
  const first = await startConversation(instrumentation, firstRooms, {
    visitorId: 'CTA102',
    sourceHandoffId: FIRST_HANDOFF,
    clientMessageId: 'create-handoff-first-1',
    message: 'Original handoff message',
  });
  assert.equal(first.response.status, 201);
  const conversationId = (await first.response.json()).conversation.id;
  const baseline = {
    conversations: count(database, 'conversations'),
    messages: count(database, 'messages'),
    traffic: count(database, 'agent_traffic_receipts'),
    conversationTraffic: count(database, 'conversation_traffic_receipts'),
    quotaReceipts: count(database, 'conversation_creation_quota_receipts'),
  };
  instrumentation.reset();
  const replayRooms = fakeRooms();

  const replay = await startConversation(instrumentation, replayRooms, {
    visitorId: 'CTA102',
    sourceHandoffId: FIRST_HANDOFF,
    clientMessageId: 'create-handoff-replay-2',
    message: 'Replay must not be persisted',
  });
  const replayBody = await replay.response.json();
  assert.equal(replay.response.status, 200);
  assert.equal(replayBody.conversation.id, conversationId);
  assert.equal(replayRooms.calls.length, 0);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.equal(metrics.executed, 7);
  assert.equal(metrics.select, 6);
  assert.equal(metrics.insert, 0);
  assert.equal(metrics.update, 1);
  assert.equal(metrics.delete, 0);
  assert.equal(metrics.batch, 0);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(handoffClaims(metrics).length, 0);
  assert.equal(assignmentWrites(metrics).length, 0);
  assert.equal(quotaExecutions(metrics).length, 0);
  assert.deepEqual(
    {
      conversations: count(database, 'conversations'),
      messages: count(database, 'messages'),
      traffic: count(database, 'agent_traffic_receipts'),
      conversationTraffic: count(database, 'conversation_traffic_receipts'),
      quotaReceipts: count(database, 'conversation_creation_quota_receipts'),
    },
    baseline,
  );
  database.close();
});

test('clientMessageId replay returns the original conversation without duplicate create or assignment', async () => {
  const { database, instrumentation } = createFixture();
  const first = await startConversation(instrumentation, fakeRooms(), {
    visitorId: 'CTA103',
    sourceHandoffId: FIRST_HANDOFF,
    clientMessageId: 'create-message-replay-1',
    message: 'Original client message',
  });
  assert.equal(first.response.status, 201);
  const conversationId = (await first.response.json()).conversation.id;
  instrumentation.reset();
  const rooms = fakeRooms();

  const replay = await startConversation(instrumentation, rooms, {
    visitorId: 'CTA103',
    sourceHandoffId: SECOND_HANDOFF,
    clientMessageId: 'create-message-replay-1',
    message: 'Same id must replay',
  });
  const body = await replay.response.json();
  assert.equal(replay.response.status, 200);
  assert.equal(body.conversation.id, conversationId);
  assert.equal(rooms.calls.length, 0);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.equal(metrics.executed, 7);
  assert.equal(metrics.select, 6);
  assert.equal(metrics.insert, 0);
  assert.equal(metrics.update, 1);
  assert.equal(metrics.delete, 0);
  assert.equal(metrics.batch, 0);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(conversationCreates(metrics).length, 0);
  assert.equal(handoffClaims(metrics).length, 0);
  assert.equal(assignmentWrites(metrics).length, 0);
  assert.equal(quotaExecutions(metrics).length, 0);
  assert.equal(count(database, 'conversations'), 1);
  assert.equal(count(database, 'messages'), 1);
  assert.equal(count(database, 'agent_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_creation_quota_receipts'), 1);
  database.close();
});

test('active reuse claims the fresh handoff without re-consuming assignment or quota', async () => {
  const { database, instrumentation } = createFixture();
  const first = await startConversation(instrumentation, fakeRooms(), {
    visitorId: 'CTA104',
    sourceHandoffId: FIRST_HANDOFF,
    clientMessageId: 'create-active-first-1',
    message: 'First active message',
  });
  assert.equal(first.response.status, 201);
  const conversationId = (await first.response.json()).conversation.id;
  instrumentation.reset();
  const rooms = fakeRooms();

  const reused = await startConversation(instrumentation, rooms, {
    visitorId: 'CTA104',
    sourceHandoffId: SECOND_HANDOFF,
    clientMessageId: 'create-active-second-2',
    message: 'Second active message',
  });
  const body = await reused.response.json();
  assert.equal(reused.response.status, 200);
  assert.equal(body.conversation.id, conversationId);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.equal(metrics.executed, 11);
  assert.equal(metrics.select, 7);
  assert.equal(metrics.insert, 2);
  assert.equal(metrics.update, 2);
  assert.equal(metrics.delete, 0);
  assert.equal(metrics.batch, 1);
  assert.equal(metrics.batchStatements, 2);
  assert.deepEqual(metrics.batchSizes, [2]);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(handoffClaims(metrics).length, 1);
  assert.equal(changedRows(handoffClaims(metrics)), 1);
  assert.equal(handoffOwnerReads(metrics).length, 0);
  assert.equal(ownedConversationReads(metrics).length, 1);
  assert.equal(conversationCreates(metrics).length, 0);
  assert.equal(assignmentWrites(metrics).length, 0);
  assert.equal(quotaExecutions(metrics).length, 0);
  assert.equal(messageInserts(metrics).length, 1);
  assert.equal(changedRows(messageInserts(metrics)), 1);
  assert.equal(rooms.calls.length, 3);
  assert.equal(count(database, 'conversations'), 1);
  assert.equal(count(database, 'messages'), 2);
  assert.equal(count(database, 'conversation_source_handoffs'), 2);
  assert.equal(count(database, 'agent_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_creation_quota_receipts'), 1);
  database.close();
});

test('closed affinity remains only a priority and ineligible original agent falls through to strict RR', async () => {
  const { database, instrumentation } = createFixture([
    'agent-affinity-a',
    'agent-affinity-b',
  ]);
  const first = await startConversation(instrumentation, fakeRooms(), {
    visitorId: 'CTA105',
    sourceHandoffId: FIRST_HANDOFF,
  });
  assert.equal(first.response.status, 201);
  const firstBody = await first.response.json();
  assert.equal(firstBody.conversation.agentName, 'Agent agent-affinity-a');
  database
    .prepare(
      `UPDATE conversations
       SET status = 'closed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    )
    .run(firstBody.conversation.id);
  database
    .prepare(
      `UPDATE agents SET status = 'offline' WHERE id = 'agent-affinity-a'`,
    )
    .run();
  instrumentation.reset();
  const rooms = fakeRooms();

  const second = await startConversation(instrumentation, rooms, {
    visitorId: 'CTA105',
    sourceHandoffId: SECOND_HANDOFF,
  });
  const secondBody = await second.response.json();
  assert.equal(second.response.status, 201);
  assert.equal(secondBody.conversation.agentName, 'Agent agent-affinity-b');

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.ok(
    metrics.executed <= 16,
    `unexpected create budget: ${metrics.executed}`,
  );
  assert.ok(metrics.select <= 7, `unexpected SELECT budget: ${metrics.select}`);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(conversationCreates(metrics).length, 1);
  assert.equal(changedRows(conversationCreates(metrics)), 1);
  assert.equal(assignmentWrites(metrics).length, 1);
  assert.equal(changedRows(assignmentWrites(metrics)), 1);
  assert.equal(routingFallbackReads(metrics).length, 0);
  assert.equal(count(database, 'conversations'), 2);
  assert.equal(count(database, 'agent_traffic_receipts'), 2);
  assert.equal(count(database, 'conversation_traffic_receipts'), 2);
  assert.equal(
    database
      .prepare(
        `SELECT last_agent_id FROM routing_round_robin_cursors
         WHERE site_id = 'default'`,
      )
      .get().last_agent_id,
    'agent-affinity-b',
  );
  assert.equal(rooms.calls.length, 4);
  database.close();
});

test('no-agent path releases creation reservations in the existing cleanup batch', async () => {
  const { database, instrumentation } = createFixture([]);
  const rooms = fakeRooms();
  const result = await startConversation(instrumentation, rooms, {
    visitorId: 'CTA106',
    sourceHandoffId: THIRD_HANDOFF,
  });
  const body = await result.response.json();

  assert.equal(result.response.status, 503);
  assert.equal(body.error.code, 'NO_AGENT_AVAILABLE');
  assert.equal(result.execution.tasks.length, 0);
  assert.equal(rooms.calls.length, 0);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.equal(metrics.executed, 19);
  assert.equal(metrics.select, 5);
  assert.equal(metrics.insert, 6);
  assert.equal(metrics.update, 4);
  assert.equal(metrics.delete, 4);
  assert.equal(metrics.batch, 3);
  assert.equal(metrics.batchStatements, 10);
  assert.deepEqual(metrics.batchSizes, [2, 2, 6]);
  assert.equal(replayQueries(metrics).length, 1);
  assert.equal(conversationCreates(metrics).length, 1);
  assert.equal(changedRows(conversationCreates(metrics)), 1);
  assert.equal(handoffClaims(metrics).length, 1);
  assert.equal(changedRows(handoffClaims(metrics)), 1);
  assert.equal(assignmentWrites(metrics).length, 1);
  assert.equal(changedRows(assignmentWrites(metrics)), 0);
  assert.equal(routingFallbackReads(metrics).length, 1);
  assert.equal(metrics.batchSizes.filter((size) => size === 6).length, 1);

  assert.equal(count(database, 'conversations'), 0);
  assert.equal(count(database, 'messages'), 0);
  assert.equal(count(database, 'conversation_source_handoffs'), 0);
  assert.equal(count(database, 'conversation_creation_quota_receipts'), 0);
  assert.equal(count(database, 'conversation_traffic_receipts'), 0);
  assert.equal(count(database, 'agent_traffic_receipts'), 0);
  assert.equal(count(database, 'routing_round_robin_cursors'), 0);
  assert.deepEqual(
    database
      .prepare(
        `SELECT accepted_count FROM conversation_creation_limits
         ORDER BY subject_key`,
      )
      .all()
      .map((row) => row.accepted_count),
    [0, 0],
  );
  database.close();
});

test('concurrent duplicate claim produces one owner, one quota consumption and one assignment', async () => {
  const { database, instrumentation } = createFixture();
  seedVisitor(database, 'CTA107');
  instrumentation.reset();
  const rooms = fakeRooms();
  const input = {
    visitorId: 'CTA107',
    sourceHandoffId: FOURTH_HANDOFF,
    clientMessageId: 'create-concurrent-message-1',
    message: 'Concurrent duplicate claim',
  };

  const [left, right] = await Promise.all([
    startConversation(instrumentation, rooms, input),
    startConversation(instrumentation, rooms, input),
  ]);
  const statuses = [left.response.status, right.response.status].sort();
  assert.deepEqual(statuses, [200, 201]);
  await Promise.all([left.response.json(), right.response.json()]);

  const metrics = instrumentation.metrics();
  assertMetricIntegrity(metrics);
  assert.ok(
    metrics.executed <= 34,
    `unexpected concurrent budget: ${metrics.executed}`,
  );
  assert.ok(
    metrics.select <= 19,
    `unexpected concurrent SELECT budget: ${metrics.select}`,
  );
  assert.equal(changedRows(conversationCreates(metrics)), 1);
  assert.equal(changedRows(handoffClaims(metrics)), 1);
  assert.equal(changedRows(messageInserts(metrics)), 1);
  assert.equal(changedRows(assignmentWrites(metrics)), 1);

  assert.equal(count(database, 'conversations'), 1);
  assert.equal(count(database, 'conversation_source_handoffs'), 1);
  assert.equal(count(database, 'messages'), 1);
  assert.equal(count(database, 'agent_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_traffic_receipts'), 1);
  assert.equal(count(database, 'conversation_creation_quota_receipts'), 1);
  assert.deepEqual(
    database
      .prepare(
        `SELECT accepted_count FROM conversation_creation_limits
         ORDER BY subject_key`,
      )
      .all()
      .map((row) => row.accepted_count),
    [1, 1],
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count FROM agent_daily_stats
         WHERE agent_id = 'agent-create-cost-a'`,
      )
      .get().conversation_count,
    1,
  );
  database.close();
});
