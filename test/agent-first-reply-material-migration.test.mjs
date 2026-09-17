import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { agentAutoReplyApi } from '../src/worker/agent-auto-reply-api.ts';
import { hashAgentSessionToken } from '../src/worker/agent-session.ts';

const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((value) => /^\d+.*\.sql$/u.test(value))
  .sort();

function applyMigrations(database, through) {
  for (const name of migrationNames) {
    if (through && name > through) break;
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

function createD1(database) {
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              return database.prepare(sql).get(...bindings) ?? null;
            },
            async all() {
              return { results: database.prepare(sql).all(...bindings) };
            },
            async run() {
              return database.prepare(sql).run(...bindings);
            },
          };
        },
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        for (const statement of statements) await statement.run();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

test('0070 materializes legacy first-reply data and removes invalid relations', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database, '0069_first_reply_materials.sql');
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, traffic_quota_enabled,
         auto_greeting_enabled, auto_greeting_text
       ) VALUES (
         'legacy-agent', 'default', 'Legacy', 'legacy', 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0, 1, '  旧版问候语  '
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO agent_attachment_presets (
         id, agent_id, kind, label, value
       ) VALUES ('legacy-card', 'legacy-agent', 'sms', '短信', '+1 555 0100')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO agent_auto_greeting_ctas (
         id, agent_id, label, answer, enabled, sort_order
       ) VALUES ('legacy-cta', 'legacy-agent', '咨询', '请问您想了解什么？', 1, 0)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO agent_auto_greeting_attachments (
         agent_id, preset_id, sort_order
       ) VALUES ('legacy-agent', 'legacy-card', 0)`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO agent_sessions (
         id, agent_id, token_hash, expires_at
       ) VALUES ('session', 'legacy-agent', ?, datetime('now', '+1 day'))`,
    )
    .run(await hashAgentSessionToken('legacy-token'));

  database.exec('PRAGMA foreign_keys=OFF');
  database
    .prepare(
      `INSERT INTO agent_auto_greeting_attachments (
         agent_id, preset_id, sort_order
       ) VALUES ('legacy-agent', 'missing-card', 1)`,
    )
    .run();
  database.exec('PRAGMA foreign_keys=ON');

  database.exec(
    readFileSync(
      `${migrationsDirectory}/0070_materialize_legacy_first_reply.sql`,
      'utf8',
    ),
  );
  database.exec(
    readFileSync(
      `${migrationsDirectory}/0072_first_reply_content_items.sql`,
      'utf8',
    ),
  );

  const greeting = database
    .prepare(
      `SELECT id, agent_id, name, text
       FROM agent_greeting_presets
       WHERE agent_id = ?`,
    )
    .get('legacy-agent');
  assert.equal(greeting.id, 'legacy-greeting:legacy-agent');
  assert.equal(greeting.agent_id, 'legacy-agent');
  assert.equal(greeting.name, '默认问候语');
  assert.equal(greeting.text, '旧版问候语');
  const profile = database
    .prepare(
      `SELECT id, greeting_id, is_active
       FROM agent_first_reply_profiles
       WHERE agent_id = ?`,
    )
    .get('legacy-agent');
  assert.equal(profile.id, 'legacy-first-reply:legacy-agent');
  assert.equal(profile.greeting_id, 'legacy-greeting:legacy-agent');
  assert.equal(profile.is_active, 1);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_first_reply_profile_attachments
         WHERE profile_id = ?`,
      )
      .get('legacy-first-reply:legacy-agent').count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_first_reply_profile_ctas
         WHERE profile_id = ?`,
      )
      .get('legacy-first-reply:legacy-agent').count,
    1,
  );
  const legacyAgent = database
    .prepare(
      `SELECT auto_greeting_enabled, auto_greeting_text
       FROM agents WHERE id = ?`,
    )
    .get('legacy-agent');
  assert.equal(legacyAgent.auto_greeting_enabled, 1);
  assert.equal(legacyAgent.auto_greeting_text, '旧版问候语');

  const d1 = createD1(database);
  const loaded = await agentAutoReplyApi.request(
    '/api/agent/first-reply',
    { headers: { cookie: 'cs_agent_session=legacy-token' } },
    { DB: d1 },
  );
  const settings = await loaded.json();
  settings.settings.greetings.push({
    id: 'new-greeting',
    name: '新问候语',
    text: '新增内容',
  });
  settings.settings.profiles[0].items = settings.settings.profiles[0].items.map(
    (item) =>
      item.type === 'greeting' ? { ...item, materialId: 'new-greeting' } : item,
  );
  const added = await agentAutoReplyApi.request(
    '/api/agent/first-reply',
    {
      method: 'PATCH',
      headers: {
        cookie: 'cs_agent_session=legacy-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(settings.settings),
    },
    { DB: d1 },
  );
  assert.equal(added.status, 200);

  const updated = await added.json();
  updated.settings.enabled = false;
  updated.settings.greetings = [];
  updated.settings.profiles[0].items = [];
  const removed = await agentAutoReplyApi.request(
    '/api/agent/first-reply',
    {
      method: 'PATCH',
      headers: {
        cookie: 'cs_agent_session=legacy-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify(updated.settings),
    },
    { DB: d1 },
  );
  assert.equal(removed.status, 200);

  database.close();
});

test('0070 cleans stale canonical attachment relations', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database, '0069_first_reply_materials.sql');
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, traffic_quota_enabled,
         auto_greeting_enabled
       ) VALUES (
         'canonical-agent', 'default', 'Canonical', 'canonical', 'hash',
         'salt', 'online', 1, CURRENT_TIMESTAMP, 0, 1
       )`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO agent_first_reply_profiles (
         id, agent_id, name, is_active
       ) VALUES ('profile', 'canonical-agent', '默认', 1)`,
    )
    .run();
  database.exec('PRAGMA foreign_keys=OFF');
  database
    .prepare(
      `INSERT INTO agent_first_reply_profile_attachments (
         profile_id, preset_id, sort_order
       ) VALUES ('profile', 'missing-card', 0)`,
    )
    .run();
  database.exec('PRAGMA foreign_keys=ON');

  database.exec(
    readFileSync(
      `${migrationsDirectory}/0070_materialize_legacy_first_reply.sql`,
      'utf8',
    ),
  );

  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_first_reply_profile_attachments
         WHERE profile_id = ?`,
      )
      .get('profile').count,
    0,
  );
  const canonicalAgent = database
    .prepare(
      `SELECT auto_greeting_enabled, auto_greeting_text
       FROM agents WHERE id = ?`,
    )
    .get('canonical-agent');
  assert.equal(canonicalAgent.auto_greeting_enabled, 0);
  assert.equal(canonicalAgent.auto_greeting_text, null);

  database.close();
});
