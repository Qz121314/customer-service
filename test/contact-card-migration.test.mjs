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

function applyThrough(database, lastMigration) {
  for (const name of migrationNames) {
    if (name > lastMigration) break;
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

test('0053 migrates legacy phone/link cards without rewriting history', () => {
  const database = new DatabaseSync(':memory:');
  applyThrough(database, '0052_message_attachments.sql');
  const iconMarker =
    'contact-card-icon:v1:png:agent-card-icons/agent-1/card-sms/icon-1.png';

  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, traffic_quota_enabled
    ) VALUES (
      'agent-1', 'default', 'Agent 1', 'agent-1', 'hash', 'salt',
      'online', 1, 0
    );
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'visitor-1', 'default', 'token-1', 'ABC123', datetime('now', '+1 day')
    );
    INSERT INTO conversations (
      id, site_id, visitor_id, status, assigned_agent,
      expires_at, last_message_at, created_at, updated_at
    ) VALUES (
      'conversation-1', 'default', 'visitor-1', 'pending', 'agent-1',
      datetime('now', '+1 day'), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
    INSERT INTO messages (
      id, conversation_id, sender_type, sender_id, body, kind, created_at
    ) VALUES (
      'message-1', 'conversation-1', 'agent', 'agent-1', '联系方式', 'text', CURRENT_TIMESTAMP
    );
    INSERT INTO agent_attachment_presets (
      id, agent_id, kind, label, value, original_name, sort_order
    ) VALUES
      ('card-sms', 'agent-1', 'phone', '短信联系', '+12135551234', '${iconMarker}', 0),
      ('card-site', 'agent-1', 'link', '官方网站', 'https://example.com/', NULL, 1);
    INSERT INTO message_attachments (
      id, message_id, kind, label, value, original_name, sort_order
    ) VALUES
      ('snapshot-sms', 'message-1', 'phone', '短信联系', '+12135551234', '${iconMarker}', 0),
      ('snapshot-site', 'message-1', 'link', '官方网站', 'https://example.com/', NULL, 1);
  `);

  database.exec(
    readFileSync(`${migrationsDirectory}/0053_contact_cards.sql`, 'utf8'),
  );

  const presets = database
    .prepare(
      `SELECT id, kind, value, preset_message, icon_ref, original_name
       FROM agent_attachment_presets
       ORDER BY id`,
    )
    .all();
  assert.deepEqual(presets, [
    {
      id: 'card-site',
      kind: 'website',
      value: 'https://example.com/',
      preset_message: null,
      icon_ref: null,
      original_name: null,
    },
    {
      id: 'card-sms',
      kind: 'sms',
      value: '+12135551234',
      preset_message: null,
      icon_ref: iconMarker,
      original_name: null,
    },
  ]);

  const snapshots = database
    .prepare(
      `SELECT id, kind, value, preset_message, icon_ref, original_name
       FROM message_attachments
       ORDER BY id`,
    )
    .all();
  assert.deepEqual(snapshots, [
    {
      id: 'snapshot-site',
      kind: 'website',
      value: 'https://example.com/',
      preset_message: null,
      icon_ref: null,
      original_name: null,
    },
    {
      id: 'snapshot-sms',
      kind: 'sms',
      value: '+12135551234',
      preset_message: null,
      icon_ref: iconMarker,
      original_name: null,
    },
  ]);

  assert.throws(
    () =>
      database.exec(`
        INSERT INTO agent_attachment_presets (
          id, agent_id, kind, label, value
        ) VALUES ('old-phone', 'agent-1', 'phone', '旧电话', '+12135550000');
      `),
    /CHECK constraint failed/u,
  );

  database.close();
});
