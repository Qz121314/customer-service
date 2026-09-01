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

function applyMigrations(database) {
  for (const name of migrationNames) {
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

test('first greeting copies the configured contact card icon marker into the immutable message snapshot', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const iconMarker =
    'contact-card-icon:v1:png:agent-card-icons/agent-1/card-1/icon-1.png';

  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, traffic_quota_enabled,
      auto_greeting_enabled, auto_greeting_text
    ) VALUES (
      'agent-1', 'default', 'Agent 1', 'agent-1', 'hash', 'salt',
      'online', 1, 0, 1, '欢迎咨询'
    );
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'visitor-1', 'default', 'token-1', 'ABC123', datetime('now', '+1 day')
    );
    INSERT INTO conversations (
      id, site_id, visitor_id, status, product_id, section_id,
      product_title, expires_at, last_message_at, created_at, updated_at
    ) VALUES (
      'conversation-1', 'default', 'visitor-1', 'open', 'product-1', 'west',
      'Product 1', datetime('now', '+1 day'), CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);

  database
    .prepare(
      `INSERT INTO agent_attachment_presets (
         id, agent_id, kind, label, value, original_name, sort_order
       ) VALUES (?, ?, 'phone', ?, ?, ?, 0)`,
    )
    .run('card-1', 'agent-1', '短信联系', '+12135551234', iconMarker);
  database
    .prepare(
      `INSERT INTO agent_auto_greeting_attachments (
         agent_id, preset_id, sort_order
       ) VALUES (?, ?, 0)`,
    )
    .run('agent-1', 'card-1');

  const assignedAt = '2026-09-01T12:00:00.000Z';
  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = ?,
           assigned_at = ?,
           assigned_business_date = '2026-09-01',
           status = 'pending',
           updated_at = ?
       WHERE id = ?`,
    )
    .run('agent-1', assignedAt, assignedAt, 'conversation-1');

  const snapshot = database
    .prepare(
      `SELECT kind, label, value, original_name
       FROM message_attachments
       WHERE message_id = 'auto-greeting:conversation-1'
       LIMIT 1`,
    )
    .get();
  assert.equal(snapshot.kind, 'phone');
  assert.equal(snapshot.label, '短信联系');
  assert.equal(snapshot.value, '+12135551234');
  assert.equal(snapshot.original_name, iconMarker);

  database.exec(`
    UPDATE agent_attachment_presets
    SET original_name = NULL
    WHERE id = 'card-1';
  `);
  const unchanged = database
    .prepare(
      `SELECT original_name
       FROM message_attachments
       WHERE message_id = 'auto-greeting:conversation-1'
       LIMIT 1`,
    )
    .get();
  assert.equal(unchanged.original_name, iconMarker);

  database.close();
});
