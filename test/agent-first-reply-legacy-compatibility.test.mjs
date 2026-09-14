import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import {
  agentAutoReplyApi,
  removeMissingLegacyAttachmentIds,
} from '../src/worker/agent-auto-reply-api.ts';
import { hashAgentSessionToken } from '../src/worker/agent-session.ts';

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
              return {
                results: database.prepare(sql).all(...bindings),
              };
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

async function seedAgent(database, id, token) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, traffic_quota_enabled,
         auto_greeting_enabled, auto_greeting_text
       ) VALUES (
         ?, 'default', ?, ?, 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0, 1, ?
       )`,
    )
    .run(id, id, id, '旧版问候语');
  database
    .prepare(
      `INSERT INTO agent_sessions (
         id, agent_id, token_hash, expires_at
       ) VALUES (?, ?, ?, datetime('now', '+1 day'))`,
    )
    .run('session', id, await hashAgentSessionToken(token));
}

async function patchFirstReply(database, token, settings) {
  return agentAutoReplyApi.request(
    '/api/agent/first-reply',
    {
      method: 'PATCH',
      headers: {
        cookie: `cs_agent_session=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(settings),
    },
    { DB: createD1(database) },
  );
}

test('legacy first reply can be edited and materialized into the new model', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const token = 'legacy-edit-token';
  await seedAgent(database, 'legacy-edit-agent', token);

  const response = await patchFirstReply(database, token, {
    enabled: true,
    activeProfileId: 'legacy-first-reply',
    greetings: [
      {
        id: 'legacy-greeting',
        name: '默认问候语',
        text: '修改后的问候语',
      },
    ],
    ctas: [],
    profiles: [
      {
        id: 'legacy-first-reply',
        name: '默认首次回复',
        greetingId: 'legacy-greeting',
        attachmentIds: [],
        ctaIds: [],
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(
    database
      .prepare('SELECT text FROM agent_greeting_presets WHERE id = ?')
      .get('legacy-greeting').text,
    '修改后的问候语',
  );
  assert.equal(
    database
      .prepare(
        'SELECT greeting_id FROM agent_first_reply_profiles WHERE id = ?',
      )
      .get('legacy-first-reply').greeting_id,
    'legacy-greeting',
  );
  assert.equal(
    database
      .prepare('SELECT auto_greeting_text FROM agents WHERE id = ?')
      .get('legacy-edit-agent').auto_greeting_text,
    '修改后的问候语',
  );

  database.close();
});

test('deleting the last active greeting can save an explicitly disabled automation', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const token = 'legacy-delete-token';
  await seedAgent(database, 'legacy-delete-agent', token);

  const response = await patchFirstReply(database, token, {
    enabled: false,
    activeProfileId: 'legacy-first-reply',
    greetings: [],
    ctas: [],
    profiles: [
      {
        id: 'legacy-first-reply',
        name: '默认首次回复',
        greetingId: null,
        attachmentIds: [],
        ctaIds: [],
      },
    ],
  });

  assert.equal(response.status, 200);
  assert.equal(
    database
      .prepare(
        'SELECT auto_greeting_enabled, auto_greeting_text FROM agents WHERE id = ?',
      )
      .get('legacy-delete-agent').auto_greeting_enabled,
    0,
  );
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_greeting_presets WHERE agent_id = ?',
      )
      .get('legacy-delete-agent').count,
    0,
  );

  database.close();
});

test('legacy cleanup only removes missing attachment references from the synthetic profile', () => {
  const profiles = [
    {
      id: 'legacy-first-reply',
      name: '默认首次回复',
      greetingId: 'legacy-greeting',
      attachmentIds: ['kept', 'missing'],
      ctaIds: [],
    },
    {
      id: 'new-profile',
      name: '新方案',
      greetingId: null,
      attachmentIds: ['missing'],
      ctaIds: [],
    },
  ];

  assert.deepEqual(
    removeMissingLegacyAttachmentIds(profiles, new Set(['kept'])),
    [
      {
        ...profiles[0],
        attachmentIds: ['kept'],
      },
      profiles[1],
    ],
  );
});
