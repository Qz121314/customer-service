import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { assignConversationAgent } from '../src/worker/routing.ts';

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database) {
  return {
    prepare(sql) {
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
    },
  };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, href, section_id, section_name, is_enabled
    ) VALUES (
      'default', 'product-a', 'Product A', '/products/product-a',
      'west', 'West', 1
    );

    INSERT INTO agents (
      id, site_id, name, username, password_hash, status, is_enabled,
      max_active_conversations, daily_conversation_limit, last_seen_at,
      traffic_quota_enabled, traffic_quota_total
    ) VALUES
      (
        'agent-a', 'default', 'Agent A', 'agent-a', 'hash-a', 'online', 1,
        10, 10, CURRENT_TIMESTAMP, 1, 10
      ),
      (
        'agent-b', 'default', 'Agent B', 'agent-b', 'hash-b', 'online', 1,
        10, 10, CURRENT_TIMESTAMP, 1, 10
      );

    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES
      ('default', 'agent-a', 'section', 'west', '', '', 1),
      ('default', 'agent-b', 'section', 'west', '', '', 1);
  `);
  return database;
}

function addConversation(database, id, handoffId, visitorExternalId) {
  const visitorId = `visitor-${id}`;
  database
    .prepare(
      `INSERT INTO visitors (
         id, site_id, token_hash, external_id, expires_at
       ) VALUES (?1, 'default', ?2, ?3, '2099-01-01T00:00:00.000Z')`,
    )
    .run(visitorId, `token-${id}`, visitorExternalId);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, product_id, section_id,
         product_title, product_href, source_handoff_id, expires_at,
         last_message_at, created_at, updated_at
       ) VALUES (
         ?1, 'default', ?2, 'open', 'product-a', 'west',
         'Product A', '/products/product-a', ?3,
         '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
    )
    .run(id, visitorId, handoffId);
}

function greetingRows(database, conversationId) {
  return database
    .prepare(
      `SELECT sender_type, sender_id, body, automation_key
       FROM messages
       WHERE conversation_id = ?1 AND automation_key = 'initial_greeting'
       ORDER BY created_at, id`,
    )
    .all(conversationId);
}

function quotaState(database, agentId) {
  return database
    .prepare(
      `SELECT traffic_quota_used AS used,
         (SELECT COALESCE(SUM(conversation_count), 0)
          FROM agent_daily_stats stats
          WHERE stats.agent_id = agents.id) AS daily
       FROM agents
       WHERE id = ?1`,
    )
    .get(agentId);
}

test('initial greeting is optional and never blocks first assignment accounting', async () => {
  const database = createDatabase();
  database.exec(`UPDATE agents SET status = 'offline' WHERE id = 'agent-b'`);
  addConversation(
    database,
    'conversation-1',
    '11111111-1111-4111-8111-111111111111',
    'ABC101',
  );

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-1'))?.id,
    'agent-a',
  );
  assert.deepEqual(greetingRows(database, 'conversation-1'), []);
  assert.equal(quotaState(database, 'agent-a').used, 1);
  assert.equal(quotaState(database, 'agent-a').daily, 1);
});

test('configured greeting is created by the immutable first-receipt lifecycle exactly once', async () => {
  const database = createDatabase();
  database.exec(`
    UPDATE agents SET status = 'offline' WHERE id = 'agent-b';
    INSERT INTO agent_auto_replies (
      agent_id, site_id, reply_type, is_enabled, message_text
    ) VALUES (
      'agent-a', 'default', 'initial_greeting', 1,
      '  Hello, how can I help?  '
    );
  `);
  addConversation(
    database,
    'conversation-2',
    '22222222-2222-4222-8222-222222222222',
    'ABC102',
  );

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-2'))?.id,
    'agent-a',
  );
  assert.deepEqual(
    greetingRows(database, 'conversation-2').map((row) => ({ ...row })),
    [
      {
        sender_type: 'agent',
        sender_id: 'agent-a',
        body: 'Hello, how can I help?',
        automation_key: 'initial_greeting',
      },
    ],
  );
  const conversation = database
    .prepare(
      `SELECT visitor_unread_count, last_message_preview
       FROM conversations WHERE id = 'conversation-2'`,
    )
    .get();
  assert.equal(conversation.visitor_unread_count, 1);
  assert.equal(conversation.last_message_preview, 'Hello, how can I help?');
  assert.equal(quotaState(database, 'agent-a').used, 1);
  assert.equal(quotaState(database, 'agent-a').daily, 1);

  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL, assigned_at = NULL,
        assigned_business_date = NULL, status = 'open'
    WHERE id = 'conversation-2';
  `);
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-2'))?.id,
    'agent-a',
  );
  assert.equal(greetingRows(database, 'conversation-2').length, 1);
  assert.equal(quotaState(database, 'agent-a').used, 1);
  assert.equal(quotaState(database, 'agent-a').daily, 1);
});

test('transfer to another greeted seat cannot create a second initial greeting', async () => {
  const database = createDatabase();
  database.exec(`
    UPDATE agents SET status = 'offline' WHERE id = 'agent-b';
    INSERT INTO agent_auto_replies (
      agent_id, site_id, reply_type, is_enabled, message_text
    ) VALUES
      ('agent-a', 'default', 'initial_greeting', 1, 'Greeting A'),
      ('agent-b', 'default', 'initial_greeting', 1, 'Greeting B');
  `);
  addConversation(
    database,
    'conversation-3',
    '33333333-3333-4333-8333-333333333333',
    'ABC103',
  );

  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-3'))?.id,
    'agent-a',
  );
  database.exec(`
    UPDATE agents
    SET status = 'online', last_seen_at = CURRENT_TIMESTAMP
    WHERE id = 'agent-b';
    UPDATE conversations
    SET assigned_agent = 'agent-b', assigned_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 'conversation-3';
  `);

  const rows = greetingRows(database, 'conversation-3');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sender_id, 'agent-a');
  assert.equal(rows[0].body, 'Greeting A');
  assert.equal(quotaState(database, 'agent-a').used, 1);
  assert.equal(quotaState(database, 'agent-b').used, 0);
});

test('waiting conversation greets only when a seat is actually assigned', async () => {
  const database = createDatabase();
  database.exec(`
    UPDATE agents SET status = 'offline', last_seen_at = NULL;
    INSERT INTO agent_auto_replies (
      agent_id, site_id, reply_type, is_enabled, message_text
    ) VALUES ('agent-a', 'default', 'initial_greeting', 1, 'Now connected');
  `);
  addConversation(
    database,
    'conversation-4',
    '44444444-4444-4444-8444-444444444444',
    'ABC104',
  );

  assert.equal(
    await assignConversationAgent(d1(database), 'conversation-4'),
    null,
  );
  assert.equal(greetingRows(database, 'conversation-4').length, 0);
  assert.equal(quotaState(database, 'agent-a').used, 0);

  database.exec(`
    UPDATE agents
    SET status = 'online', last_seen_at = CURRENT_TIMESTAMP
    WHERE id = 'agent-a';
  `);
  assert.equal(
    (await assignConversationAgent(d1(database), 'conversation-4'))?.id,
    'agent-a',
  );
  assert.equal(greetingRows(database, 'conversation-4').length, 1);
  assert.equal(quotaState(database, 'agent-a').used, 1);
});

test('client start protocol accepts a message-less CTA while keeping legacy first-message input compatible', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/worker/client-api.ts', import.meta.url)),
    'utf8',
  );
  assert.match(source, /const hasInitialMessageInput =/u);
  assert.match(source, /if \(hasInitialMessageInput && !clientMessageId\)/u);
  assert.match(
    source,
    /if \(hasInitialMessageInput && !validMessage\(initialMessage\)\)/u,
  );
  assert.match(source, /if \(clientMessageId && initialMessage\)/u);
  assert.match(source, /const assignment = await assignConversationAgent/u);
});

test('agent auto reply UI explicitly preserves optional greeting semantics', () => {
  const source = readFileSync(
    fileURLToPath(
      new URL('../src/dashboard/AgentAutoReplyControl.tsx', import.meta.url),
    ),
    'utf8',
  );
  assert.match(source, />自动回复</u);
  assert.match(source, />首次问候语</u);
  assert.match(
    source,
    /未开启或未填写内容时不会发送任何自动消息，会话仍会正常建立。/u,
  );
});
