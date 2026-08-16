import assert from 'node:assert/strict';
import {
  existsSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const moduleShims = [];
for (const name of ['assignment-broadcast.ts', 'routing.ts']) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  moduleShims.push(shimPath);
}

let assignWaitingConversations;
try {
  const module = await import('../src/worker/waiting-assignment.ts');
  assignWaitingConversations = module.assignWaitingConversations;
} finally {
  for (const shimPath of moduleShims) unlinkSync(shimPath);
}

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database) {
  const counter = { count: 0 };

  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        counter.count += 1;
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async all() {
        counter.count += 1;
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        counter.count += 1;
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    counter,
    prepare: statement,
    async batch(statements) {
      const results = [];
      database.exec('BEGIN');
      try {
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fakeRooms() {
  const events = [];
  return {
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            events.push({
              name,
              payload: JSON.parse(String(init?.body ?? '{}')),
            });
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
}

function scalar(database, sql, column) {
  return database.prepare(sql).get()[column];
}

test('waiting recovery fills seat capacity in one bounded D1 batch', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const db = d1(database);
  const rooms = fakeRooms();

  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, max_active_conversations, daily_conversation_limit,
      last_seen_at, traffic_quota_enabled, traffic_quota_total, traffic_quota_used
    ) VALUES (
      'batch-agent', 'default', 'Batch Agent', 'batch-agent', 'hash', 'salt',
      'online', 1, 3, 0, CURRENT_TIMESTAMP, 1, 10, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES ('default', 'batch-agent', 'section', 'west', '', '', 1);
  `);

  for (let index = 0; index < 8; index += 1) {
    database
      .prepare(
        `INSERT INTO visitors (id, site_id, token_hash, external_id, expires_at)
         VALUES (?, 'default', ?, ?, datetime('now', '+1 day'))`,
      )
      .run(
        `visitor-${index}`,
        `token-${index}`,
        `ABC${String(index).padStart(3, '0')}`,
      );
    database
      .prepare(
        `INSERT INTO conversations (
           id, site_id, visitor_id, status, product_id, section_id,
           product_title, expires_at, last_message_at
         ) VALUES (
           ?, 'default', ?, 'open', ?, 'west', ?,
           datetime('now', '+1 day'), CURRENT_TIMESTAMP
         )`,
      )
      .run(
        `conversation-${index}`,
        `visitor-${index}`,
        `product-${index}`,
        `Product ${index}`,
      );
  }

  const ids = await assignWaitingConversations(
    { DB: db, CONVERSATION_ROOMS: rooms.namespace },
    'batch-agent',
    20,
  );

  assert.equal(ids.length, 3);
  assert.equal(db.counter.count, 4);
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count
       FROM conversations
       WHERE assigned_agent = 'batch-agent'`,
      'count',
    ),
    3,
  );
  assert.equal(
    scalar(
      database,
      `SELECT traffic_quota_used
       FROM agents
       WHERE id = 'batch-agent'`,
      'traffic_quota_used',
    ),
    3,
  );
  assert.equal(
    scalar(
      database,
      `SELECT COUNT(*) AS count
       FROM agent_traffic_receipts
       WHERE agent_id = 'batch-agent'`,
      'count',
    ),
    3,
  );
  assert.ok(rooms.events.length >= 3);

  db.counter.count = 0;
  const noCapacity = await assignWaitingConversations(
    { DB: db, CONVERSATION_ROOMS: rooms.namespace },
    'batch-agent',
  );
  assert.deepEqual(noCapacity, []);
  assert.equal(db.counter.count, 1);

  database.close();
});
