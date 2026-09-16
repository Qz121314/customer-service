import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  collectRecentVisitorPhoneMessages,
  collectVisitorPhoneMessage,
  extractVisitorPhoneNumbers,
} from '../src/worker/visitor-phone-collection.ts';

function createD1(database) {
  return {
    prepare(sql) {
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        first() {
          return database.prepare(sql).get(...bindings) ?? null;
        },
        all() {
          return { results: database.prepare(sql).all(...bindings) };
        },
        run() {
          database.prepare(sql).run(...bindings);
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      for (const statement of statements) statement.run();
      return [];
    },
  };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE visitor_phone_numbers (
      number TEXT PRIMARY KEY,
      first_collected_at TEXT NOT NULL
    );
    CREATE TABLE visitor_phone_collection_scans (
      message_id TEXT PRIMARY KEY,
      scanned_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      sender_type TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

test('extracts only unique digit runs with at least seven digits', () => {
  assert.deepEqual(
    extractVisitorPhoneNumbers(
      '订单 123456，手机号 13800138000，重复 13800138000，尾号 7654321',
    ),
    ['13800138000', '7654321'],
  );
});

test('persists visitor phone numbers idempotently with the message time', async () => {
  const database = createDatabase();
  const db = createD1(database);
  const message = {
    id: 'message-1',
    body: '请联系 13800138000',
    created_at: '2026-09-16T12:00:00.000Z',
  };

  await collectVisitorPhoneMessage(db, message);
  await collectVisitorPhoneMessage(db, message);

  const stored = database
    .prepare('SELECT number, first_collected_at FROM visitor_phone_numbers')
    .all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].number, '13800138000');
  assert.equal(stored[0].first_collected_at, '2026-09-16T12:00:00.000Z');
  database.close();
});

test('backfill scans only recent visitor messages before retention cleanup', async () => {
  const database = createDatabase();
  const db = createD1(database);
  database
    .prepare(
      `INSERT INTO messages (id, sender_type, body, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
    )
    .run('visitor-1', 'visitor', '13800138000', '2026-09-16T11:00:00.000Z');
  database
    .prepare(
      `INSERT INTO messages (id, sender_type, body, created_at)
     VALUES (?1, ?2, ?3, ?4)`,
    )
    .run('agent-1', 'agent', '13900139000', '2026-09-16T11:01:00.000Z');

  assert.equal(
    await collectRecentVisitorPhoneMessages(
      db,
      new Date('2026-09-16T12:00:00.000Z'),
    ),
    1,
  );
  const stored = database
    .prepare('SELECT number FROM visitor_phone_numbers')
    .all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].number, '13800138000');
  const scans = database
    .prepare('SELECT message_id FROM visitor_phone_collection_scans')
    .all();
  assert.equal(scans.length, 1);
  assert.equal(scans[0].message_id, 'visitor-1');
  database.close();
});
