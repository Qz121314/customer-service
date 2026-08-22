import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import {
  consumeConversationCreationQuota,
  passesBurstLimit,
  requestSourceHash,
  SOURCE_CONVERSATION_LIMIT,
  VISITOR_CONVERSATION_LIMIT,
} from '../src/worker/abuse-control.ts';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  const migration = fileURLToPath(
    new URL(
      '../migrations/0022_conversation_abuse_limits.sql',
      import.meta.url,
    ),
  );
  database.exec(readFileSync(migration, 'utf8'));
  database.exec(`
    CREATE TABLE conversation_creation_quota_receipts (
      site_id TEXT NOT NULL,
      reuse_key TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (site_id, reuse_key)
    );
  `);
  return database;
}

function d1(database) {
  function prepare(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async all() {
        return { results: database.prepare(sql).all(...bindings) };
      },
      async first() {
        return database.prepare(sql).get(...bindings) ?? null;
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  return {
    prepare,
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function acceptedCount(database, subjectKey) {
  return (
    database
      .prepare(
        `SELECT accepted_count
         FROM conversation_creation_limits
         WHERE site_id = 'default' AND subject_key = ?`,
      )
      .get(subjectKey)?.accepted_count ?? 0
  );
}

test('visitor conversation quota has a fixed indexed 24-hour cost', async () => {
  const database = createDatabase();
  const db = d1(database);
  const now = new Date('2026-08-15T12:00:00.000Z');

  for (let index = 0; index < VISITOR_CONVERSATION_LIMIT; index += 1) {
    assert.deepEqual(
      await consumeConversationCreationQuota(db, {
        siteId: 'default',
        visitorId: 'ABC123',
        sourceHash: 'source-a',
        now,
      }),
      { allowed: true },
    );
  }
  const blocked = await consumeConversationCreationQuota(db, {
    siteId: 'default',
    visitorId: 'ABC123',
    sourceHash: 'source-a',
    now,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'VISITOR_CONVERSATION_LIMIT_REACHED');
  assert.equal(blocked.retryAfterSeconds, 24 * 60 * 60);
  assert.equal(
    acceptedCount(database, 'source:source-a'),
    VISITOR_CONVERSATION_LIMIT,
    'a visitor rejection must not consume the source counter',
  );

  const reset = await consumeConversationCreationQuota(db, {
    siteId: 'default',
    visitorId: 'ABC123',
    sourceHash: 'source-a',
    now: new Date('2026-08-16T12:00:01.000Z'),
  });
  assert.deepEqual(reset, { allowed: true });
  database.close();
});

test('source quota survives visitor id changes without scanning conversations', async () => {
  const database = createDatabase();
  const db = d1(database);
  const now = new Date('2026-08-15T12:00:00.000Z');

  for (let index = 0; index < SOURCE_CONVERSATION_LIMIT; index += 1) {
    const result = await consumeConversationCreationQuota(db, {
      siteId: 'default',
      visitorId: `visitor-${index}`,
      sourceHash: 'shared-source',
      now,
    });
    assert.deepEqual(result, { allowed: true });
  }
  const blocked = await consumeConversationCreationQuota(db, {
    siteId: 'default',
    visitorId: 'another-visitor',
    sourceHash: 'shared-source',
    now,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'SOURCE_CONVERSATION_LIMIT_REACHED');
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM conversation_creation_limits')
      .get().count,
    SOURCE_CONVERSATION_LIMIT + 1,
    'a source rejection must not create or consume the new visitor counter',
  );
  assert.equal(acceptedCount(database, 'visitor:another-visitor'), 0);
  database.close();
});

test('source fingerprint stores no raw address and edge limiter is optional', async () => {
  const fingerprint = await requestSourceHash(
    new globalThis.Request('https://example.test', {
      headers: {
        'CF-Connecting-IP': '203.0.113.10',
        'User-Agent': 'Example Browser',
      },
    }),
    'ABC123',
  );
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(fingerprint, /203\.0\.113\.10/u);
  assert.equal(await passesBurstLimit(undefined, 'key'), true);
  assert.equal(
    await passesBurstLimit({ limit: async () => ({ success: false }) }, 'key'),
    false,
  );
});

test('one CTA reuse key consumes creation quota only once', async () => {
  const database = createDatabase();
  const db = d1(database);
  const now = new Date('2026-08-15T12:00:00.000Z');
  const input = {
    siteId: 'default',
    visitorId: 'ABC123',
    sourceHash: 'source-a',
    now,
    idempotencyKey: 'same-product-start',
    idempotencyExpiresAt: '2026-08-15T14:00:00.000Z',
  };

  assert.deepEqual(await consumeConversationCreationQuota(db, input), {
    allowed: true,
  });
  assert.deepEqual(await consumeConversationCreationQuota(db, input), {
    allowed: true,
  });
  assert.equal(acceptedCount(database, 'visitor:ABC123'), 1);
  assert.equal(acceptedCount(database, 'source:source-a'), 1);
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM conversation_creation_quota_receipts',
      )
      .get().count,
    1,
  );

  database.close();
});
