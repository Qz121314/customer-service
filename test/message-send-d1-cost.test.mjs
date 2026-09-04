import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentApi,
  applyMigrations,
  blockingRooms,
  changedRows,
  clientApi,
  createExecutionContext,
  createInstrumentedD1,
  DatabaseSync,
  executionsMatching,
  fakeRooms,
  sha256,
} from './helpers/performance-runtime.mjs';

const AGENT_ID = 'agent-message-cost';
const CONVERSATION_ID = 'conversation-message-cost';
const VISITOR_DATABASE_ID = 'visitor-message-cost';
const VISITOR_ID = 'MSG123';
const SESSION_TOKEN = 'message-cost-session-token';

function createMessageFixture(status = 'open') {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, status, is_enabled,
         last_seen_at
       ) VALUES (?1, 'default', 'Message Cost Agent', 'message-cost-agent',
         'test-password-hash', 'online', 1, CURRENT_TIMESTAMP)`,
    )
    .run(AGENT_ID);
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES ('message-cost-session', ?1, ?2, ?3)`,
    )
    .run(AGENT_ID, sha256(SESSION_TOKEN), expiresAt);
  database
    .prepare(
      `INSERT INTO visitors (
         id, site_id, external_id, token_hash, display_name, expires_at
       ) VALUES (?1, 'default', ?2, 'unused-message-cost-token',
         'Message Cost Visitor', ?3)`,
    )
    .run(VISITOR_DATABASE_ID, VISITOR_ID, expiresAt);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, assigned_agent,
         visitor_unread_count, agent_unread_count, expires_at,
         last_message_at, created_at, updated_at, last_message_preview
       ) VALUES (?1, 'default', ?2, ?3, ?4, 0, 0, ?5,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)`,
    )
    .run(
      CONVERSATION_ID,
      VISITOR_DATABASE_ID,
      status,
      AGENT_ID,
      expiresAt,
    );
  const instrumentation = createInstrumentedD1(database);
  return { database, instrumentation };
}

function agentRequest(clientMessageId, body = 'Agent cost message') {
  return {
    method: 'POST',
    headers: {
      cookie: `cs_agent_session=${SESSION_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ body, clientMessageId }),
  };
}

function visitorRequest(clientMessageId, body = 'Visitor cost message') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      visitorId: VISITOR_ID,
      projectId: 'default',
      body,
      clientMessageId,
    }),
  };
}

function messageInserts(metrics) {
  return executionsMatching(
    metrics,
    /\bINSERT(?: OR IGNORE)? INTO messages\b/iu,
    'INSERT',
  );
}

function conversationUpdates(metrics) {
  return executionsMatching(metrics, /\bUPDATE conversations\b/iu, 'UPDATE');
}

function messageReads(metrics) {
  return executionsMatching(metrics, /\bFROM messages\b/iu, 'SELECT');
}

function broadcasterConversationReads(metrics) {
  return executionsMatching(
    metrics,
    /SELECT c\.id, c\.site_id,[\s\S]*c\.last_message_preview AS last_message,[\s\S]*v\.external_id,[\s\S]*WHERE c\.id = \?1[\s\S]*LIMIT 1/iu,
    'SELECT',
  );
}

async function responseBeforeRealtime(request) {
  return Promise.race([
    request,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('message response waited for realtime DO')),
        500,
      ),
    ),
  ]);
}

test('agent text normal success has an executable bounded D1 budget and snapshot realtime', async () => {
  const { database, instrumentation } = createMessageFixture('open');
  const rooms = blockingRooms();
  const execution = createExecutionContext();
  const env = {
    DB: instrumentation.db,
    CONVERSATION_ROOMS: rooms.namespace,
  };

  const response = await responseBeforeRealtime(
    agentApi.request(
      `/api/agent/conversations/${CONVERSATION_ID}/messages`,
      agentRequest('agent-normal-cost-1'),
      env,
      execution.context,
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(execution.tasks.length, 1);
  assert.deepEqual(rooms.completed, []);

  const durableMetrics = instrumentation.metrics();
  assert.equal(durableMetrics.executed, 4);
  assert.equal(durableMetrics.select, 2);
  assert.equal(messageInserts(durableMetrics).length, 1);
  assert.equal(changedRows(messageInserts(durableMetrics)), 1);
  assert.equal(conversationUpdates(durableMetrics).length, 1);
  assert.equal(changedRows(conversationUpdates(durableMetrics)), 1);
  assert.equal(messageReads(durableMetrics).length, 0);
  assert.equal(broadcasterConversationReads(durableMetrics).length, 0);

  const state = database
    .prepare(
      `SELECT status, visitor_unread_count, agent_unread_count,
         last_message_preview
       FROM conversations WHERE id = ?1`,
    )
    .get(CONVERSATION_ID);
  assert.equal(state.status, 'pending');
  assert.equal(state.visitor_unread_count, 1);
  assert.equal(state.agent_unread_count, 0);
  assert.equal(state.last_message_preview, 'Agent cost message');
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ?1 AND client_message_id = ?2`,
      )
      .get(CONVERSATION_ID, 'agent-normal-cost-1').count,
    1,
  );

  rooms.release();
  await execution.drain();
  const finalMetrics = instrumentation.metrics();
  assert.deepEqual(
    {
      prepare: finalMetrics.prepare,
      first: finalMetrics.first,
      all: finalMetrics.all,
      run: finalMetrics.run,
      batch: finalMetrics.batch,
      batchStatements: finalMetrics.batchStatements,
      executed: finalMetrics.executed,
      select: finalMetrics.select,
      insert: finalMetrics.insert,
      update: finalMetrics.update,
      delete: finalMetrics.delete,
    },
    {
      prepare: 5,
      first: 4,
      all: 0,
      run: 1,
      batch: 0,
      batchStatements: 0,
      executed: 5,
      select: 3,
      insert: 1,
      update: 1,
      delete: 0,
    },
  );
  assert.equal(broadcasterConversationReads(finalMetrics).length, 0);
  assert.equal(rooms.calls.length, 3);
  assert.deepEqual(
    [...rooms.completed].sort(),
    [
      CONVERSATION_ID,
      `client:default:${VISITOR_ID}`,
      `agent-inbox:${AGENT_ID}`,
    ].sort(),
  );
  database.close();
});

test('agent duplicate clientMessageId does not repeat state mutation or realtime', async () => {
  const { database, instrumentation } = createMessageFixture('pending');
  const rooms = fakeRooms();
  const env = {
    DB: instrumentation.db,
    CONVERSATION_ROOMS: rooms.namespace,
  };
  const firstExecution = createExecutionContext();
  const first = await agentApi.request(
    `/api/agent/conversations/${CONVERSATION_ID}/messages`,
    agentRequest('agent-duplicate-cost-1'),
    env,
    firstExecution.context,
  );
  assert.equal(first.status, 201);
  await firstExecution.drain();
  const callsAfterFirst = rooms.calls.length;
  instrumentation.reset();

  const duplicateExecution = createExecutionContext();
  const duplicate = await agentApi.request(
    `/api/agent/conversations/${CONVERSATION_ID}/messages`,
    agentRequest('agent-duplicate-cost-1'),
    env,
    duplicateExecution.context,
  );
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(duplicateExecution.tasks.length, 0);
  assert.equal(rooms.calls.length, callsAfterFirst);

  const metrics = instrumentation.metrics();
  assert.deepEqual(
    {
      prepare: metrics.prepare,
      first: metrics.first,
      all: metrics.all,
      run: metrics.run,
      batch: metrics.batch,
      executed: metrics.executed,
      select: metrics.select,
      insert: metrics.insert,
      update: metrics.update,
    },
    {
      prepare: 4,
      first: 3,
      all: 0,
      run: 1,
      batch: 0,
      executed: 4,
      select: 3,
      insert: 1,
      update: 0,
    },
  );
  assert.equal(changedRows(messageInserts(metrics)), 0);
  assert.equal(conversationUpdates(metrics).length, 0);
  assert.equal(messageReads(metrics).length, 1);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ?1 AND client_message_id = ?2`,
      )
      .get(CONVERSATION_ID, 'agent-duplicate-cost-1').count,
    1,
  );
  database.close();
});

test('agent message conflict performs only the necessary idempotency lookup', async () => {
  const { database, instrumentation } = createMessageFixture('pending');
  database
    .prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body,
         client_message_id, created_at
       ) VALUES ('visitor-conflict-message', ?1, 'visitor', ?2,
         'Existing visitor message', 'agent-conflict-cost-1', CURRENT_TIMESTAMP)`,
    )
    .run(CONVERSATION_ID, VISITOR_DATABASE_ID);
  instrumentation.reset();
  const rooms = fakeRooms();
  const execution = createExecutionContext();
  const response = await agentApi.request(
    `/api/agent/conversations/${CONVERSATION_ID}/messages`,
    agentRequest('agent-conflict-cost-1'),
    { DB: instrumentation.db, CONVERSATION_ROOMS: rooms.namespace },
    execution.context,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'MESSAGE_ID_CONFLICT' });
  assert.equal(execution.tasks.length, 0);
  assert.equal(rooms.calls.length, 0);
  const metrics = instrumentation.metrics();
  assert.equal(metrics.executed, 4);
  assert.equal(metrics.select, 3);
  assert.equal(metrics.insert, 1);
  assert.equal(metrics.update, 0);
  assert.equal(changedRows(messageInserts(metrics)), 0);
  assert.equal(messageReads(metrics).length, 1);
  database.close();
});

test('agent closed conversation blocks writes while preserving duplicate behavior', async (t) => {
  await t.test('new message is rejected without persistence or realtime', async () => {
    const { database, instrumentation } = createMessageFixture('closed');
    const rooms = fakeRooms();
    const execution = createExecutionContext();
    const response = await agentApi.request(
      `/api/agent/conversations/${CONVERSATION_ID}/messages`,
      agentRequest('agent-closed-cost-1'),
      { DB: instrumentation.db, CONVERSATION_ROOMS: rooms.namespace },
      execution.context,
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'CONVERSATION_CLOSED' });
    const metrics = instrumentation.metrics();
    assert.equal(metrics.executed, 3);
    assert.equal(metrics.select, 3);
    assert.equal(metrics.insert, 0);
    assert.equal(metrics.update, 0);
    assert.equal(execution.tasks.length, 0);
    assert.equal(rooms.calls.length, 0);
    database.close();
  });

  await t.test('existing duplicate remains idempotent', async () => {
    const { database, instrumentation } = createMessageFixture('closed');
    database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, sender_type, sender_id, body,
           client_message_id, created_at
         ) VALUES ('closed-duplicate-message', ?1, 'agent', ?2,
           'Already sent', 'agent-closed-duplicate-cost-1', CURRENT_TIMESTAMP)`,
      )
      .run(CONVERSATION_ID, AGENT_ID);
    instrumentation.reset();
    const rooms = fakeRooms();
    const execution = createExecutionContext();
    const response = await agentApi.request(
      `/api/agent/conversations/${CONVERSATION_ID}/messages`,
      agentRequest('agent-closed-duplicate-cost-1'),
      { DB: instrumentation.db, CONVERSATION_ROOMS: rooms.namespace },
      execution.context,
    );

    assert.equal(response.status, 200);
    assert.equal((await response.json()).duplicate, true);
    const metrics = instrumentation.metrics();
    assert.equal(metrics.executed, 3);
    assert.equal(metrics.select, 3);
    assert.equal(metrics.insert, 0);
    assert.equal(metrics.update, 0);
    assert.equal(execution.tasks.length, 0);
    assert.equal(rooms.calls.length, 0);
    database.close();
  });
});

test('visitor text normal success uses persistence results for snapshot realtime', async () => {
  const { database, instrumentation } = createMessageFixture('pending');
  const rooms = blockingRooms();
  const execution = createExecutionContext();
  const env = {
    DB: instrumentation.db,
    CONVERSATION_ROOMS: rooms.namespace,
  };

  const response = await responseBeforeRealtime(
    clientApi.request(
      `/client/v1/conversations/${CONVERSATION_ID}/messages`,
      visitorRequest('visitor-normal-cost-1'),
      env,
      execution.context,
    ),
  );
  assert.equal(response.status, 201);
  assert.equal(execution.tasks.length, 1);
  assert.deepEqual(rooms.completed, []);

  const metrics = instrumentation.metrics();
  assert.deepEqual(
    {
      prepare: metrics.prepare,
      first: metrics.first,
      all: metrics.all,
      run: metrics.run,
      batch: metrics.batch,
      batchStatements: metrics.batchStatements,
      batchSizes: metrics.batchSizes,
      executed: metrics.executed,
      select: metrics.select,
      insert: metrics.insert,
      update: metrics.update,
      delete: metrics.delete,
    },
    {
      prepare: 5,
      first: 3,
      all: 0,
      run: 2,
      batch: 1,
      batchStatements: 2,
      batchSizes: [2],
      executed: 5,
      select: 3,
      insert: 1,
      update: 1,
      delete: 0,
    },
  );
  assert.equal(messageInserts(metrics).length, 1);
  assert.equal(changedRows(messageInserts(metrics)), 1);
  assert.equal(conversationUpdates(metrics).length, 1);
  assert.equal(changedRows(conversationUpdates(metrics)), 1);
  assert.equal(messageReads(metrics).length, 0);
  assert.equal(broadcasterConversationReads(metrics).length, 0);

  const state = database
    .prepare(
      `SELECT agent_unread_count, last_message_preview
       FROM conversations WHERE id = ?1`,
    )
    .get(CONVERSATION_ID);
  assert.equal(state.agent_unread_count, 1);
  assert.equal(state.last_message_preview, 'Visitor cost message');
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ?1 AND client_message_id = ?2`,
      )
      .get(CONVERSATION_ID, 'visitor-normal-cost-1').count,
    1,
  );

  rooms.release();
  await execution.drain();
  assert.equal(broadcasterConversationReads(instrumentation.metrics()).length, 0);
  assert.equal(rooms.calls.length, 3);
  assert.deepEqual(
    [...rooms.completed].sort(),
    [
      CONVERSATION_ID,
      `client:default:${VISITOR_ID}`,
      `agent-inbox:${AGENT_ID}`,
    ].sort(),
  );
  database.close();
});

test('visitor duplicate returns the existing message without a second state mutation or realtime', async () => {
  const { database, instrumentation } = createMessageFixture('pending');
  const rooms = fakeRooms();
  const env = {
    DB: instrumentation.db,
    CONVERSATION_ROOMS: rooms.namespace,
  };
  const firstExecution = createExecutionContext();
  const first = await clientApi.request(
    `/client/v1/conversations/${CONVERSATION_ID}/messages`,
    visitorRequest('visitor-duplicate-cost-1'),
    env,
    firstExecution.context,
  );
  assert.equal(first.status, 201);
  await firstExecution.drain();
  const stateAfterFirst = database
    .prepare(
      `SELECT agent_unread_count, last_message_preview
       FROM conversations WHERE id = ?1`,
    )
    .get(CONVERSATION_ID);
  const callsAfterFirst = rooms.calls.length;
  instrumentation.reset();

  const duplicateExecution = createExecutionContext();
  const duplicate = await clientApi.request(
    `/client/v1/conversations/${CONVERSATION_ID}/messages`,
    visitorRequest('visitor-duplicate-cost-1'),
    env,
    duplicateExecution.context,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateExecution.tasks.length, 0);
  assert.equal(rooms.calls.length, callsAfterFirst);

  const metrics = instrumentation.metrics();
  assert.deepEqual(
    {
      prepare: metrics.prepare,
      first: metrics.first,
      all: metrics.all,
      run: metrics.run,
      batch: metrics.batch,
      batchStatements: metrics.batchStatements,
      executed: metrics.executed,
      select: metrics.select,
      insert: metrics.insert,
      update: metrics.update,
    },
    {
      prepare: 6,
      first: 4,
      all: 0,
      run: 2,
      batch: 1,
      batchStatements: 2,
      executed: 6,
      select: 4,
      insert: 1,
      update: 1,
    },
  );
  assert.equal(changedRows(messageInserts(metrics)), 0);
  assert.equal(changedRows(conversationUpdates(metrics)), 0);
  assert.equal(messageReads(metrics).length, 1);
  assert.equal(broadcasterConversationReads(metrics).length, 0);
  assert.deepEqual(
    database
      .prepare(
        `SELECT agent_unread_count, last_message_preview
         FROM conversations WHERE id = ?1`,
      )
      .get(CONVERSATION_ID),
    stateAfterFirst,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ?1 AND client_message_id = ?2`,
      )
      .get(CONVERSATION_ID, 'visitor-duplicate-cost-1').count,
    1,
  );
  database.close();
});
