import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  CONVERSATION_LIFETIME_HOURS,
  conversationExpiresAt,
  purgeExpiredConversations,
} from '../src/worker/conversation-retention.ts';

function createRetentionDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE sites (
      id TEXT PRIMARY KEY
    );
    CREATE TABLE visitors (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      external_id TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
      FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE media_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE TABLE visitor_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      visitor_external_id TEXT NOT NULL
    );
    CREATE TABLE agent_daily_stats (
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      conversation_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (site_id, agent_id, business_date)
    );
    CREATE INDEX idx_agent_daily_stats_business_date
      ON agent_daily_stats(site_id, business_date, agent_id);
    CREATE TABLE agent_traffic_receipts (
      conversation_id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      business_date TEXT NOT NULL
    );
    CREATE INDEX idx_agent_traffic_receipts_month
      ON agent_traffic_receipts(site_id, business_date, agent_id);

    INSERT INTO sites (id) VALUES ('default');
  `);
  return database;
}

function d1(database) {
  const counter = { count: 0 };
  function prepare(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async all() {
        counter.count += 1;
        return { results: database.prepare(sql).all(...bindings) };
      },
      async first() {
        counter.count += 1;
        return database.prepare(sql).get(...bindings) ?? null;
      },
      async run() {
        counter.count += 1;
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  return { prepare, counter };
}

function rowCount(database, table) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

test('conversation expiry is fixed at 24 hours after creation', () => {
  assert.equal(CONVERSATION_LIFETIME_HOURS, 24);
  assert.equal(
    conversationExpiresAt('2026-08-14T10:00:00.000Z'),
    '2026-08-15T10:00:00.000Z',
  );
});

test('cron cleanup removes conversation trees with bounded D1 work', async () => {
  const database = createRetentionDatabase();
  const db = d1(database);
  const deletedObjects = [];
  const env = {
    DB: db,
    MEDIA: {
      async delete(keys) {
        deletedObjects.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    },
  };
  const createdAt = '2026-08-14T00:00:00.000Z';
  const expiresAt = '2026-08-15T00:00:00.000Z';

  const insertVisitor = database.prepare(
    `INSERT INTO visitors (id, site_id, external_id, expires_at, created_at)
     VALUES (?, 'default', ?, ?, ?)`,
  );
  const insertConversation = database.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, expires_at, created_at)
     VALUES (?, 'default', ?, ?, ?)`,
  );
  const insertMessage = database.prepare(
    'INSERT INTO messages (id, conversation_id) VALUES (?, ?)',
  );
  const insertMedia = database.prepare(
    `INSERT INTO media_items (id, conversation_id, object_key, status, updated_at)
     VALUES (?, ?, ?, 'ready', ?)`,
  );
  const insertPush = database.prepare(
    `INSERT INTO visitor_push_subscriptions (endpoint, site_id, visitor_external_id)
     VALUES (?, 'default', ?)`,
  );

  database.exec('BEGIN');
  for (let index = 0; index < 250; index += 1) {
    const visitorId = `visitor-${index}`;
    const externalId = `external-${index}`;
    const conversationId = `conversation-${index}`;
    insertVisitor.run(visitorId, externalId, expiresAt, createdAt);
    insertConversation.run(conversationId, visitorId, expiresAt, createdAt);
    insertMessage.run(`message-${index}`, conversationId);
    insertMedia.run(
      `media-${index}`,
      conversationId,
      `conversation/${conversationId}/image.webp`,
      createdAt,
    );
    insertPush.run(`https://push.example/${index}`, externalId);
  }
  database.exec('COMMIT');

  const result = await purgeExpiredConversations(
    env,
    new Date('2026-08-15T12:07:00.000Z'),
  );

  assert.deepEqual(result, {
    conversations: 250,
    mediaObjects: 250,
    staleMediaObjects: 0,
    visitors: 200,
  });
  assert.equal(db.counter.count, 14);
  assert.equal(rowCount(database, 'conversations'), 0);
  assert.equal(rowCount(database, 'messages'), 0);
  assert.equal(rowCount(database, 'media_items'), 0);
  assert.equal(rowCount(database, 'visitors'), 50);
  assert.equal(rowCount(database, 'visitor_push_subscriptions'), 50);
  assert.equal(deletedObjects.length, 250);

  db.counter.count = 0;
  const followUp = await purgeExpiredConversations(
    env,
    new Date('2026-08-15T12:08:00.000Z'),
  );
  assert.equal(followUp.visitors, 50);
  assert.equal(db.counter.count, 3);
  assert.equal(rowCount(database, 'visitors'), 0);
  assert.equal(rowCount(database, 'visitor_push_subscriptions'), 0);
  database.close();
});

test('reporting history cleanup runs once daily and preserves the 400-day window', async () => {
  const database = createRetentionDatabase();
  const db = d1(database);
  const env = {
    DB: db,
    MEDIA: {
      async delete() {},
    },
  };

  database.exec(`
    INSERT INTO agent_daily_stats (
      site_id, agent_id, business_date, conversation_count
    ) VALUES
      ('default', 'old-agent', '2025-07-12', 1),
      ('default', 'boundary-agent', '2025-07-13', 1);
    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, business_date
    ) VALUES
      ('old-receipt', 'default', 'old-agent', '2025-07-12'),
      ('boundary-receipt', 'default', 'boundary-agent', '2025-07-13');
  `);

  await purgeExpiredConversations(env, new Date('2026-08-16T12:00:00.000Z'));

  assert.equal(rowCount(database, 'agent_daily_stats'), 1);
  assert.equal(rowCount(database, 'agent_traffic_receipts'), 1);
  assert.equal(
    database
      .prepare('SELECT business_date FROM agent_daily_stats LIMIT 1')
      .get().business_date,
    '2025-07-13',
  );

  database.exec(`
    INSERT INTO agent_daily_stats (
      site_id, agent_id, business_date, conversation_count
    ) VALUES ('default', 'late-old-agent', '2025-07-12', 1);
    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, business_date
    ) VALUES ('late-old-receipt', 'default', 'late-old-agent', '2025-07-12');
  `);

  await purgeExpiredConversations(env, new Date('2026-08-16T12:01:00.000Z'));

  assert.equal(rowCount(database, 'agent_daily_stats'), 2);
  assert.equal(rowCount(database, 'agent_traffic_receipts'), 2);
  database.close();
});
