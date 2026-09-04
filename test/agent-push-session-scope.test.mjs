import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

test('agent push subscriptions follow device session lifetime', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, daily_conversation_limit,
         traffic_quota_enabled, traffic_quota_total, traffic_quota_used
       ) VALUES (
         'agent-push-scope', 'default', 'Push Scope', 'push-scope',
         'hash', 'salt', 'online', 1, 0, 0, 0, 0
       )`,
    )
    .run();

  for (const id of ['desktop-session', 'phone-session']) {
    database
      .prepare(
        `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
         VALUES (?, 'agent-push-scope', ?, datetime('now', '+1 hour'))`,
      )
      .run(id, `${id}-token-hash`);
  }

  for (const [endpoint, sessionId] of [
    ['https://push.example/desktop', 'desktop-session'],
    ['https://push.example/phone', 'phone-session'],
  ]) {
    database
      .prepare(
        `INSERT INTO agent_push_subscriptions (
           endpoint, agent_id, p256dh, auth, session_id
         ) VALUES (?, 'agent-push-scope', 'key', 'auth', ?)`,
      )
      .run(endpoint, sessionId);
  }

  database
    .prepare(`DELETE FROM agent_sessions WHERE id = 'phone-session'`)
    .run();
  assert.deepEqual(
    database
      .prepare(
        `SELECT endpoint, session_id
         FROM agent_push_subscriptions
         ORDER BY endpoint ASC`,
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        endpoint: 'https://push.example/desktop',
        session_id: 'desktop-session',
      },
    ],
  );

  database
    .prepare(`DELETE FROM agent_sessions WHERE id = 'desktop-session'`)
    .run();
  assert.equal(
    database
      .prepare(`SELECT COUNT(*) AS count FROM agent_push_subscriptions`)
      .get().count,
    0,
  );
  database.close();
});

