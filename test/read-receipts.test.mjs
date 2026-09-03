import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  existsSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import { routeRegistration } from './helpers/source-contract.mjs';

const workerPath = new URL('../src/worker/', import.meta.url).pathname;
const moduleShims = [];
for (const name of readdirSync(workerPath)) {
  if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
  const shimPath = join(workerPath, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  moduleShims.push(shimPath);
}

let clientApi;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
} finally {
  for (const shimPath of moduleShims) unlinkSync(shimPath);
}

const migration = await readFile(
  new URL('../migrations/0011_read_receipts.sql', import.meta.url),
  'utf8',
);
const cursorMigration = await readFile(
  new URL(
    '../migrations/0046_reduce_free_tier_write_amplification.sql',
    import.meta.url,
  ),
  'utf8',
);

function applyMigrations(database) {
  const migrationsDirectory = new URL('../migrations/', import.meta.url)
    .pathname;
  for (const name of readdirSync(migrationsDirectory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(join(migrationsDirectory, name), 'utf8'));
  }
}

function d1(database) {
  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }
  return { prepare: statement };
}

function fakeDoNamespace(calls) {
  return {
    idFromName(name) {
      return { name };
    },
    get(id) {
      return {
        async fetch() {
          calls.push(id.name);
          return new Response('ok');
        },
      };
    },
  };
}

test('read receipt migration adds persistent agent read state', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(migration);

  const columns = db.prepare('PRAGMA table_info(messages)').all();
  assert.equal(
    columns.some((column) => column.name === 'read_by_agent_at'),
    true,
  );

  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, sender_type, created_at, read_by_agent_at
    ) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'message-1',
    'conversation-1',
    'visitor',
    '2026-08-14T10:00:00.000Z',
    null,
  );

  const row = db
    .prepare('SELECT read_by_agent_at FROM messages WHERE id = ?')
    .get('message-1');
  assert.equal(row.read_by_agent_at, null);

  db.close();
});

test('conversation read cursors replace hot per-message writes and stale indexes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      site_id TEXT NOT NULL,
      group_id TEXT,
      assigned_agent TEXT,
      assigned_business_date TEXT,
      last_message_at TEXT NOT NULL
    );
    CREATE INDEX idx_conversations_status_last_message
      ON conversations(status, last_message_at DESC);
    CREATE INDEX idx_conversations_site_last_message
      ON conversations(site_id, last_message_at DESC);
    CREATE INDEX idx_conversations_group_assignment
      ON conversations(site_id, group_id, status, assigned_agent, last_message_at DESC);
    CREATE INDEX idx_conversations_agent_business_date
      ON conversations(site_id, assigned_agent, assigned_business_date);
    CREATE INDEX idx_conversations_business_date
      ON conversations(site_id, assigned_business_date);
  `);
  db.exec(cursorMigration);

  const columns = db.prepare('PRAGMA table_info(conversations)').all();
  for (const name of [
    'agent_read_through_at',
    'agent_read_through_id',
    'agent_read_at',
    'visitor_read_through_at',
    'visitor_read_through_id',
    'visitor_read_at',
  ]) {
    assert.equal(
      columns.some((column) => column.name === name),
      true,
      name,
    );
  }

  const indexes = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => row.name),
  );
  for (const name of [
    'idx_conversations_status_last_message',
    'idx_conversations_site_last_message',
    'idx_conversations_group_assignment',
    'idx_conversations_agent_business_date',
    'idx_conversations_business_date',
  ]) {
    assert.equal(indexes.has(name), false, name);
  }
  db.close();
});

test('read APIs preserve payload fields while updating only conversation cursors', async () => {
  const [agent, client] = await Promise.all([
    readFile(new URL('../src/worker/agent-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker/client-api.ts', import.meta.url), 'utf8'),
  ]);
  const agentRead = routeRegistration(
    agent,
    "agentApi.post('/api/agent/conversations/:id/read'",
  );
  const visitorRead = routeRegistration(
    client,
    "clientApi.post('/client/v1/conversations/:id/read'",
  );

  assert.doesNotMatch(agentRead, /UPDATE messages/u);
  assert.doesNotMatch(visitorRead, /UPDATE messages/u);
  assert.match(agentRead, /agent_read_through_at/u);
  assert.match(visitorRead, /visitor_read_through_at/u);
  assert.match(agent, /AS read_by_agent_at/u);
  assert.match(client, /AS read_by_visitor_at/u);
});

test('visitor read handler runtime budget skips only the agent inbox room', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  database
    .prepare(
      `INSERT INTO visitors (id, site_id, external_id, token_hash, expires_at)
       VALUES ('visitor-1', 'default', 'ABC123', 'unused-token-hash', ?1)`,
    )
    .run(expiresAt);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, assigned_agent, expires_at,
         last_message_at, created_at, updated_at
       ) VALUES ('conversation-1', 'default', 'visitor-1', 'open', 'agent-1', ?1,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .run(expiresAt);
  database
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_type, sender_id, body, created_at)
       VALUES ('agent-message-1', 'conversation-1', 'agent', 'agent-1', 'Hello', CURRENT_TIMESTAMP)`,
    )
    .run();

  const calls = [];
  const response = await clientApi.request(
    '/client/v1/conversations/conversation-1/read',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ visitorId: 'ABC123', projectId: 'default' }),
    },
    { DB: d1(database), CONVERSATION_ROOMS: fakeDoNamespace(calls) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls.sort(), ['client:default:ABC123', 'conversation-1']);
  assert.equal(
    calls.some((name) => name.startsWith('agent-inbox:')),
    false,
  );
  database.close();
});

test('visitor read resource budget keeps conversation and visitor rooms only', async () => {
  const client = await readFile(
    new URL('../src/worker/client-api.ts', import.meta.url),
    'utf8',
  );
  const visitorRead = routeRegistration(
    client,
    "clientApi.post('/client/v1/conversations/:id/read'",
  );
  assert.match(visitorRead, /broadcastRoomSafely\(c\.env, conversation\.id/u);
  assert.match(visitorRead, /includeAgentInbox: false/u);
  assert.doesNotMatch(visitorRead, /agentInboxRoom|conversation\.changed/u);
});
