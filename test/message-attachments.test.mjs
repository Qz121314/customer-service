import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import {
  listConversationAttachments,
  normalizeAttachmentLabel,
  normalizeLinkValue,
  normalizePhoneValue,
} from '../src/worker/message-attachments.ts';

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

test('phone normalization keeps optional international plus and strips formatting', () => {
  assert.equal(normalizePhoneValue('+1 (213) 555-1234'), '+12135551234');
  assert.equal(normalizePhoneValue('213 555 1234'), '2135551234');
  assert.equal(normalizePhoneValue('+86 138 0013 8000'), '+8613800138000');
  assert.equal(normalizePhoneValue('1234'), null);
  assert.equal(normalizePhoneValue('+1 213 555 1234 ext 5'), null);
  assert.equal(normalizePhoneValue('javascript:alert(1)'), null);
});

test('link normalization only accepts absolute http and https URLs', () => {
  assert.equal(
    normalizeLinkValue('https://example.com/pay?id=123'),
    'https://example.com/pay?id=123',
  );
  assert.equal(normalizeLinkValue('http://example.com'), 'http://example.com/');
  assert.equal(normalizeLinkValue('javascript:alert(1)'), null);
  assert.equal(normalizeLinkValue('data:text/html,hello'), null);
  assert.equal(normalizeLinkValue('file:///tmp/test'), null);
  assert.equal(normalizeLinkValue('/relative/path'), null);
});

test('attachment labels reject empty and oversized values', () => {
  assert.equal(normalizeAttachmentLabel('  联系客服  '), '联系客服');
  assert.equal(normalizeAttachmentLabel('   '), null);
  assert.equal(normalizeAttachmentLabel('x'.repeat(81)), null);
});

test('unified conversation attachment history keeps legacy media and snapshot attachments', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
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
    ) VALUES
      ('message-image', 'conversation-1', 'agent', 'agent-1', '', 'image', '2026-08-18T20:00:00.000Z'),
      ('message-action', 'conversation-1', 'agent', 'agent-1', '联系信息', 'text', '2026-08-18T20:01:00.000Z');
    INSERT INTO media_items (
      id, conversation_id, message_id, reserved_message_id, sender_type, sender_id,
      object_key, mime_type, byte_size, width, height, original_name,
      status, is_initial, reserved_created_at, created_at, updated_at
    ) VALUES (
      'legacy-image', 'conversation-1', 'message-image', 'message-image', 'agent', 'agent-1',
      'chat/conversation-1/legacy-image.png', 'image/png', 128, 320, 180, 'legacy.png',
      'ready', 0, '2026-08-18T20:00:00.000Z', '2026-08-18T20:00:00.000Z', '2026-08-18T20:00:00.000Z'
    );
    INSERT INTO message_attachments (
      id, message_id, kind, label, value, sort_order, created_at
    ) VALUES
      ('phone-1', 'message-action', 'phone', '短信联系', '+12135551234', 0, '2026-08-18T20:01:00.000Z'),
      ('link-1', 'message-action', 'link', '付款链接', 'https://example.com/pay', 1, '2026-08-18T20:01:00.000Z');
  `);

  const attachments = await listConversationAttachments(
    {
      prepare(sql) {
        return {
          bind(...bindings) {
            return {
              async all() {
                return { results: database.prepare(sql).all(...bindings) };
              },
            };
          },
        };
      },
    },
    'conversation-1',
  );

  assert.deepEqual(
    attachments.map((item) => [item.messageId, item.kind, item.label]),
    [
      ['message-action', 'phone', '短信联系'],
      ['message-action', 'link', '付款链接'],
      ['message-image', 'image', 'legacy.png'],
    ],
  );
  assert.equal(
    attachments.find((item) => item.id === 'legacy-image')?.source,
    'media',
  );
  assert.equal(
    attachments.find((item) => item.id === 'phone-1')?.value,
    '+12135551234',
  );

  database.close();
});
