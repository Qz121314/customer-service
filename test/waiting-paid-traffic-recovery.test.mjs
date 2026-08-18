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

  return { counter, prepare: statement };
}

function fakeRooms() {
  return {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          return { status: 204 };
        },
      };
    },
  };
}

function addWaitingConversation(database, index) {
  database
    .prepare(
      `INSERT INTO visitors (id, site_id, token_hash, external_id, expires_at)
       VALUES (?, 'default', ?, ?, datetime('now', '+1 day'))`,
    )
    .run(`visitor-${index}`, `token-${index}`, `ABC00${index}`);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, product_id, section_id,
         product_title, expires_at, last_message_at
       ) VALUES (
         ?, 'default', ?, 'open', ?, 'west', ?,
         datetime('now', '+1 day'), datetime('now', ?)
       )`,
    )
    .run(
      `conversation-${index}`,
      `visitor-${index}`,
      `product-${index}`,
      `Product ${index}`,
      `+${index} seconds`,
    );
}

test('already-paid waiting conversation recovers while fresh traffic stays blocked', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const db = d1(database);
  const env = { DB: db, CONVERSATION_ROOMS: fakeRooms() };

  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, max_active_conversations, daily_conversation_limit,
      last_seen_at, traffic_quota_enabled, traffic_quota_total, traffic_quota_used
    ) VALUES (
      'paid-agent', 'default', 'Paid Agent', 'paid-agent', 'hash', 'salt',
      'online', 1, 2, 1, CURRENT_TIMESTAMP, 1, 1, 0
    );
    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id,
      is_enabled
    ) VALUES ('default', 'paid-agent', 'section', 'west', '', '', 1);
  `);
  addWaitingConversation(database, 0);
  addWaitingConversation(database, 1);

  const first = await assignWaitingConversations(env, 'paid-agent');
  assert.deepEqual(first, ['conversation-0']);
  assert.equal(
    database
      .prepare(`SELECT traffic_quota_used AS used FROM agents WHERE id = 'paid-agent'`)
      .get().used,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats WHERE agent_id = 'paid-agent'`,
      )
      .get().count,
    1,
  );

  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL,
        assigned_at = NULL,
        assigned_business_date = NULL,
        status = 'open'
    WHERE id = 'conversation-0';
  `);

  db.counter.count = 0;
  const recovered = await assignWaitingConversations(env, 'paid-agent');
  assert.deepEqual(recovered, ['conversation-0']);
  assert.equal(db.counter.count, 4);
  assert.equal(
    database
      .prepare(`SELECT traffic_quota_used AS used FROM agents WHERE id = 'paid-agent'`)
      .get().used,
    1,
    'recovery must not consume another paid unit',
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats WHERE agent_id = 'paid-agent'`,
      )
      .get().count,
    1,
    'recovery must not consume another daily unit',
  );
  assert.equal(
    database
      .prepare(
        `SELECT assigned_agent FROM conversations WHERE id = 'conversation-1'`,
      )
      .get().assigned_agent,
    null,
    'fresh traffic must remain waiting when paid and daily quotas are exhausted',
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_traffic_receipts WHERE conversation_id = 'conversation-0'`,
      )
      .get().count,
    1,
  );

  database.close();
});
