import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((value) => /^\d+.*\.sql$/u.test(value))
  .sort();

function applyMigrations(database, through = null, after = null) {
  for (const name of migrationNames) {
    if (after && name <= after) continue;
    if (through && name > through) continue;
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

function addAgent(
  database,
  id,
  { greetingEnabled = false, greetingText = null } = {},
) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, traffic_quota_enabled,
         auto_greeting_enabled, auto_greeting_text
       ) VALUES (
         ?, 'default', ?, ?, 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0, ?, ?
       )`,
    )
    .run(id, id, id, greetingEnabled ? 1 : 0, greetingText);
}

function addConversation(database, id, visitorId = `${id}-visitor`) {
  database
    .prepare(
      `INSERT INTO visitors (
         id, site_id, token_hash, external_id, expires_at
       ) VALUES (?, 'default', ?, ?, datetime('now', '+1 day'))`,
    )
    .run(
      visitorId,
      `${visitorId}-token`,
      `ABC${String(id.length).padStart(3, '0')}`,
    );
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, product_id, section_id,
         product_title, expires_at, last_message_at, created_at, updated_at
       ) VALUES (
         ?, 'default', ?, 'open', 'product-1', 'west',
         'Product 1', datetime('now', '+1 day'), CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )`,
    )
    .run(id, visitorId);
}

function assign(database, conversationId, agentId, at) {
  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = ?,
           assigned_at = ?,
           assigned_business_date = '2026-08-18',
           status = 'pending',
           updated_at = ?
       WHERE id = ?`,
    )
    .run(agentId, at, at, conversationId);
}

function row(database, sql, ...bindings) {
  return database.prepare(sql).get(...bindings);
}

function count(database, table, where = '1 = 1', ...bindings) {
  return Number(
    row(
      database,
      `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`,
      ...bindings,
    ).count,
  );
}

test('first effective assignment sends one configured greeting as a normal agent message', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  addAgent(database, 'greeting-agent', {
    greetingEnabled: true,
    greetingText: '  您好，我来为您服务。  ',
  });
  addConversation(database, 'greeting-conversation');

  const assignedAt = '2026-08-18T20:00:00.000Z';
  assign(database, 'greeting-conversation', 'greeting-agent', assignedAt);

  assert.equal(
    count(
      database,
      'agent_traffic_receipts',
      'conversation_id = ?',
      'greeting-conversation',
    ),
    1,
  );
  const automation = row(
    database,
    `SELECT outcome, agent_id, message_id, message_body, resolved_at
     FROM conversation_automation_receipts
     WHERE conversation_id = ? AND automation_key = 'initial_greeting'`,
    'greeting-conversation',
  );
  assert.equal(automation.outcome, 'sent');
  assert.equal(automation.agent_id, 'greeting-agent');
  assert.equal(automation.message_id, 'auto-greeting:greeting-conversation');
  assert.equal(automation.message_body, '您好，我来为您服务。');
  assert.equal(automation.resolved_at, assignedAt);

  const message = row(
    database,
    `SELECT sender_type, sender_id, body, client_message_id, created_at
     FROM messages WHERE id = ?`,
    automation.message_id,
  );
  assert.equal(message.sender_type, 'agent');
  assert.equal(message.sender_id, 'greeting-agent');
  assert.equal(message.body, '您好，我来为您服务。');
  assert.equal(message.client_message_id, 'auto-greeting:v1');
  assert.equal(message.created_at, assignedAt);

  const conversation = row(
    database,
    `SELECT agent_unread_count, visitor_unread_count, last_message_preview
     FROM conversations WHERE id = ?`,
    'greeting-conversation',
  );
  assert.equal(conversation.agent_unread_count, 1);
  assert.equal(conversation.visitor_unread_count, 1);
  assert.equal(conversation.last_message_preview, '您好，我来为您服务。');

  database.close();
});

test('greeting is optional and a disabled greeting never blocks first reception', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  addAgent(database, 'plain-agent');
  addConversation(database, 'plain-conversation');

  assign(
    database,
    'plain-conversation',
    'plain-agent',
    '2026-08-18T20:01:00.000Z',
  );

  const automation = row(
    database,
    `SELECT outcome, message_id, message_body
     FROM conversation_automation_receipts
     WHERE conversation_id = ? AND automation_key = 'initial_greeting'`,
    'plain-conversation',
  );
  assert.equal(automation.outcome, 'skipped');
  assert.equal(automation.message_id, null);
  assert.equal(automation.message_body, null);
  assert.equal(
    count(database, 'messages', 'conversation_id = ?', 'plain-conversation'),
    0,
  );

  const conversation = row(
    database,
    `SELECT assigned_agent, agent_unread_count, visitor_unread_count
     FROM conversations WHERE id = ?`,
    'plain-conversation',
  );
  assert.equal(conversation.assigned_agent, 'plain-agent');
  assert.equal(conversation.agent_unread_count, 1);
  assert.equal(conversation.visitor_unread_count, 0);

  database.close();
});

test('requeue, transfer and later setting changes cannot repeat or retroactively add a greeting', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  addAgent(database, 'first-agent', {
    greetingEnabled: true,
    greetingText: '第一次问候',
  });
  addAgent(database, 'second-agent', {
    greetingEnabled: true,
    greetingText: '不应该补发',
  });
  addConversation(database, 'one-shot-conversation');

  assign(
    database,
    'one-shot-conversation',
    'first-agent',
    '2026-08-18T20:02:00.000Z',
  );
  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL,
        assigned_at = NULL,
        assigned_business_date = NULL,
        status = 'open'
    WHERE id = 'one-shot-conversation';
  `);
  assign(
    database,
    'one-shot-conversation',
    'second-agent',
    '2026-08-18T20:03:00.000Z',
  );
  database.exec(`
    UPDATE agents
    SET auto_greeting_text = '后来修改的问候', auto_greeting_enabled = 1
    WHERE id = 'first-agent';
  `);

  assert.equal(
    count(
      database,
      'agent_traffic_receipts',
      'conversation_id = ?',
      'one-shot-conversation',
    ),
    1,
  );
  assert.equal(
    count(
      database,
      'conversation_automation_receipts',
      "conversation_id = ? AND automation_key = 'initial_greeting'",
      'one-shot-conversation',
    ),
    1,
  );
  assert.equal(
    count(database, 'messages', 'conversation_id = ?', 'one-shot-conversation'),
    1,
  );
  const message = row(
    database,
    `SELECT sender_id, body FROM messages WHERE conversation_id = ?`,
    'one-shot-conversation',
  );
  assert.equal(message.sender_id, 'first-agent');
  assert.equal(message.body, '第一次问候');

  database.close();
});

test('0035 marks every pre-existing conversation resolved without retroactive greeting', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database, '0034_agent_quota_ledger_baselines.sql');

  database.exec(`
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'legacy-visitor', 'default', 'legacy-token', 'ABC123', datetime('now', '+1 day')
    );
    INSERT INTO conversations (
      id, site_id, visitor_id, status, product_id, section_id,
      product_title, expires_at, last_message_at, created_at, updated_at
    ) VALUES (
      'legacy-waiting', 'default', 'legacy-visitor', 'open', 'product-1', 'west',
      'Product 1', datetime('now', '+1 day'), CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);

  applyMigrations(database, null, '0034_agent_quota_ledger_baselines.sql');

  const automation = row(
    database,
    `SELECT outcome, agent_id, message_id
     FROM conversation_automation_receipts
     WHERE conversation_id = 'legacy-waiting'
       AND automation_key = 'initial_greeting'`,
  );
  assert.equal(automation.outcome, 'skipped');
  assert.equal(automation.agent_id, null);
  assert.equal(automation.message_id, null);
  assert.equal(
    count(database, 'messages', "conversation_id = 'legacy-waiting'"),
    0,
  );

  database.close();
});
