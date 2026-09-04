import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { URL } from 'node:url';
import {
  ORPHAN_VISITOR_BATCH_SQL,
  STALE_FAILED_MEDIA_SELECT_SQL,
  STALE_PENDING_MEDIA_UPDATE_SQL,
  purgeExpiredConversations,
} from '../src/worker/conversation-retention.ts';

const migrationsDirectory = new URL('../migrations/', import.meta.url);

function createMigratedDatabase() {
  const database = new DatabaseSync(':memory:');
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const filename of migrationFiles) {
    database.exec(readFileSync(new URL(filename, migrationsDirectory), 'utf8'));
  }
  return database;
}

function seedPlannerFixture(database) {
  database.exec('PRAGMA foreign_keys = OFF; BEGIN;');
  const insertVisitor = database.prepare(
    `INSERT INTO visitors (
       id, site_id, token_hash, display_name, created_at, last_seen_at,
       external_id, expires_at
     ) VALUES (?, 'default', ?, ?, ?, ?, ?, ?)`,
  );
  const insertConversation = database.prepare(
    `INSERT INTO conversations (
       id, site_id, visitor_id, status, last_message_at, created_at,
       updated_at, expires_at
     ) VALUES (?, 'default', ?, 'open', ?, ?, ?, ?)`,
  );
  const insertMedia = database.prepare(
    `INSERT INTO media_items (
       id, conversation_id, reserved_message_id, sender_type, sender_id,
       object_key, mime_type, byte_size, width, height, original_name,
       status, is_initial, reserved_created_at, created_at, updated_at
     ) VALUES (?, ?, ?, 'visitor', ?, ?, 'image/webp', 1024, 100, 100,
       'fixture.webp', ?, 0, ?, ?, ?)`,
  );

  for (let index = 0; index < 512; index += 1) {
    const createdAt = '2026-09-01T00:00:00.000Z';
    const currentAt = '2026-09-04T12:30:00.000Z';
    const expiresAt =
      index % 2 === 0 ? '2026-09-03T00:00:00.000Z' : '2026-09-06T00:00:00.000Z';
    const visitorId = `visitor-${index}`;
    insertVisitor.run(
      visitorId,
      `token-${index}`,
      `Visitor ${index}`,
      createdAt,
      createdAt,
      `external-${index}`,
      expiresAt,
    );

    if (index % 4 !== 0) {
      insertConversation.run(
        `conversation-${index}`,
        visitorId,
        currentAt,
        createdAt,
        currentAt,
        expiresAt,
      );
    }

    const isStaleMedia = index % 16 === 0;
    const pendingUpdatedAt = isStaleMedia
      ? '2026-09-03T08:00:00.000Z'
      : currentAt;
    const failedUpdatedAt = isStaleMedia
      ? '2026-09-03T09:00:00.000Z'
      : currentAt;

    for (const [suffix, status, updatedAt] of [
      ['pending', 'pending', pendingUpdatedAt],
      ['failed', 'failed', failedUpdatedAt],
      ['ready', 'ready', currentAt],
    ]) {
      insertMedia.run(
        `media-${suffix}-${index}`,
        `conversation-${index}`,
        `reserved-${suffix}-${index}`,
        visitorId,
        `chat/${index}/${suffix}.webp`,
        status,
        createdAt,
        createdAt,
        updatedAt,
      );
    }
  }
  database.exec('COMMIT; PRAGMA foreign_keys = ON; ANALYZE;');
}

function explain(database, sql, bindings) {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...bindings)
    .map((row) => String(row.detail));
}

function assertSearchesIndex(plan, tableOrAlias, indexName) {
  assert.ok(
    plan.some(
      (detail) =>
        detail.includes(`SEARCH ${tableOrAlias} USING`) &&
        detail.includes(indexName),
    ),
    `expected SEARCH ${tableOrAlias} using ${indexName}; got:\n${plan.join('\n')}`,
  );
}

function assertNoTableScan(plan, tableOrAlias) {
  assert.equal(
    plan.some((detail) => detail.startsWith(`SCAN ${tableOrAlias}`)),
    false,
    `unexpected SCAN ${tableOrAlias}:\n${plan.join('\n')}`,
  );
}

test('orphan visitor cleanup range-searches expiry and the conversation left prefix', () => {
  const database = createMigratedDatabase();
  seedPlannerFixture(database);

  const plan = explain(database, ORPHAN_VISITOR_BATCH_SQL, [
    '2026-09-04T13:00:00.000Z',
    100,
  ]);

  assertSearchesIndex(plan, 'v', 'idx_visitors_expires');
  assertSearchesIndex(plan, 'c', 'idx_conversations_visitor_expiry');
  assertNoTableScan(plan, 'v');
  assertNoTableScan(plan, 'c');
  database.close();
});

test('hourly stale media cleanup range-searches narrow partial indexes', () => {
  const database = createMigratedDatabase();
  seedPlannerFixture(database);

  const pendingPlan = explain(database, STALE_PENDING_MEDIA_UPDATE_SQL, [
    '2026-09-04T13:00:00.000Z',
    '2026-09-04T11:00:00.000Z',
  ]);
  const failedPlan = explain(database, STALE_FAILED_MEDIA_SELECT_SQL, [
    '2026-09-04T12:00:00.000Z',
    100,
  ]);

  assertSearchesIndex(
    pendingPlan,
    'media_items',
    'idx_media_items_cleanup_queue',
  );
  assertSearchesIndex(
    failedPlan,
    'media_items',
    'idx_media_items_cleanup_queue',
  );
  assertNoTableScan(pendingPlan, 'media_items');
  assertNoTableScan(failedPlan, 'media_items');
  assert.equal(
    failedPlan.some((detail) => detail.includes('USE TEMP B-TREE')),
    false,
    `failed media cleanup should not sort through a temp B-tree:\n${failedPlan.join('\n')}`,
  );
  database.close();
});

function createRetentionBehaviorDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE visitors (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      external_id TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_visitors_expires ON visitors(expires_at);
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      visitor_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_conversations_visitor_expiry
      ON conversations(site_id, visitor_id, expires_at);
    CREATE TABLE media_items (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_media_items_cleanup_queue
      ON media_items(status, updated_at, id)
      WHERE status = 'pending' OR status = 'failed';
    CREATE TABLE visitor_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      visitor_external_id TEXT NOT NULL
    );
  `);
  return database;
}

function d1(database) {
  function prepare(sql) {
    let bindings = [];
    const statement = () => database.prepare(sql);
    const executeRun = () => {
      const result = statement().run(...bindings);
      return { meta: { changes: Number(result.changes) } };
    };
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async all() {
        return { results: statement().all(...bindings) };
      },
      async first() {
        return statement().get(...bindings) ?? null;
      },
      async run() {
        return executeRun();
      },
      executeRun,
    };
  }
  async function batch(statements) {
    database.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.executeRun());
      database.exec('COMMIT');
      return results;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
  return { prepare, batch };
}

test('JS cutoffs preserve stale media boundary and R2 cleanup semantics', async () => {
  const database = createRetentionBehaviorDatabase();
  const deletedObjects = [];
  const env = {
    DB: d1(database),
    MEDIA: {
      async delete(keys) {
        deletedObjects.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    },
  };

  database.exec(`
    INSERT INTO visitors (
      id, site_id, external_id, expires_at, created_at
    ) VALUES (
      'visitor-active', 'default', 'external-active',
      '2026-09-05T13:00:00.000Z', '2026-09-03T13:00:00.000Z'
    );
    INSERT INTO conversations (
      id, site_id, visitor_id, expires_at, created_at
    ) VALUES (
      'conversation-active', 'default', 'visitor-active',
      '2026-09-05T13:00:00.000Z', '2026-09-03T13:00:00.000Z'
    );
    INSERT INTO media_items (
      id, conversation_id, object_key, status, updated_at
    ) VALUES
      ('pending-boundary', 'conversation-active', 'pending-boundary.webp',
       'pending', '2026-09-04T11:00:00.000Z'),
      ('pending-fresh', 'conversation-active', 'pending-fresh.webp',
       'pending', '2026-09-04T11:00:00.001Z'),
      ('failed-boundary', 'conversation-active', 'failed-boundary.webp',
       'failed', '2026-09-04T12:00:00.000Z'),
      ('failed-fresh', 'conversation-active', 'failed-fresh.webp',
       'failed', '2026-09-04T12:00:00.001Z');
  `);

  const result = await purgeExpiredConversations(
    env,
    new Date('2026-09-04T13:00:00.000Z'),
  );

  assert.equal(result.staleMediaObjects, 1);
  assert.deepEqual(deletedObjects, ['failed-boundary.webp']);
  assert.deepEqual(
    database
      .prepare('SELECT id, status, updated_at FROM media_items ORDER BY id')
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: 'failed-fresh',
        status: 'failed',
        updated_at: '2026-09-04T12:00:00.001Z',
      },
      {
        id: 'pending-boundary',
        status: 'failed',
        updated_at: '2026-09-04T13:00:00.000Z',
      },
      {
        id: 'pending-fresh',
        status: 'pending',
        updated_at: '2026-09-04T11:00:00.001Z',
      },
    ],
  );
  database.close();
});
