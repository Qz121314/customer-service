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
const shims = [];
for (const name of ['assignment-broadcast.ts', 'routing.ts']) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let assignWaitingConversations;
try {
  ({ assignWaitingConversations } = await import(
    '../src/worker/waiting-assignment.ts'
  ));
} finally {
  for (const shimPath of shims) unlinkSync(shimPath);
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
      async all() {
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
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
  return {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          return new Response(null, { status: 204 });
        },
      };
    },
  };
}

function insertAgent(database, id, name) {
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at, max_active_conversations,
         daily_conversation_limit, traffic_quota_enabled,
         traffic_quota_total, traffic_quota_used
       ) VALUES (
         ?, 'default', ?, ?, 'hash', 'salt',
         'online', 1, CURRENT_TIMESTAMP, 0,
         0, 1, 20, 0
       )`,
    )
    .run(id, name, id);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id,
         product_id, is_enabled
       ) VALUES ('default', ?, 'section', 'west', '', '', 1)`,
    )
    .run(id);
}

test('legacy affinity deadline is removed from the conversation schema', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);

  const columns = database.prepare('PRAGMA table_info(conversations)').all();
  assert.equal(
    columns.some((column) => column.name === 'cta_affinity_expires_at'),
    false,
  );
  assert.equal(
    columns.some((column) => column.name === 'cta_affinity_agent_id'),
    true,
  );

  database.close();
});

test('waiting recovery honors 24-hour affinity and manual requeue can override it', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  insertAgent(database, 'bound-agent', 'Bound Agent');
  insertAgent(database, 'other-agent', 'Other Agent');

  database.exec(`
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'visitor-1', 'default', 'token-1', 'ABC123', datetime('now', '+1 day')
    );

    INSERT INTO conversations (
      id, site_id, visitor_id, status, product_id, section_id,
      product_title, cta_affinity_agent_id, expires_at, last_message_at
    ) VALUES (
      'protected-conversation', 'default', 'visitor-1', 'open',
      'product-1', 'west', 'Product 1', 'bound-agent',
      datetime('now', '+1 day'), CURRENT_TIMESTAMP
    );
  `);

  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms(),
  };

  const stolen = await assignWaitingConversations(env, 'other-agent');
  assert.deepEqual(stolen, []);
  assert.equal(
    database
      .prepare(
        `SELECT assigned_agent FROM conversations
         WHERE id = 'protected-conversation'`,
      )
      .get().assigned_agent,
    null,
  );

  const recovered = await assignWaitingConversations(env, 'bound-agent');
  assert.deepEqual(recovered, ['protected-conversation']);

  database.exec(`
    UPDATE conversations
    SET assigned_agent = NULL,
        assigned_at = NULL,
        assigned_business_date = NULL,
        status = 'open'
    WHERE id = 'protected-conversation';
  `);

  const released = database
    .prepare(
      `SELECT cta_affinity_agent_id, requeue_excluded_agent_id
       FROM conversations
       WHERE id = 'protected-conversation'`,
    )
    .get();
  assert.equal(released.cta_affinity_agent_id, null);
  assert.equal(released.requeue_excluded_agent_id, 'bound-agent');

  const reassigned = await assignWaitingConversations(env, 'other-agent');
  assert.deepEqual(reassigned, ['protected-conversation']);

  database.close();
});

test('explicit ownership transfer becomes the new cycle affinity', () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  insertAgent(database, 'agent-a', 'Agent A');
  insertAgent(database, 'agent-b', 'Agent B');

  database.exec(`
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'visitor-2', 'default', 'token-2', 'DEF456', datetime('now', '+1 day')
    );

    INSERT INTO conversations (
      id, site_id, visitor_id, status, product_id, section_id,
      product_title, assigned_agent, cta_affinity_agent_id,
      expires_at, last_message_at
    ) VALUES (
      'transfer-conversation', 'default', 'visitor-2', 'pending',
      'product-2', 'west', 'Product 2', 'agent-a', 'agent-a',
      datetime('now', '+1 day'), CURRENT_TIMESTAMP
    );

    UPDATE conversations
    SET assigned_agent = 'agent-b'
    WHERE id = 'transfer-conversation';
  `);

  const row = database
    .prepare(
      `SELECT assigned_agent, cta_affinity_agent_id
       FROM conversations
       WHERE id = 'transfer-conversation'`,
    )
    .get();
  assert.equal(row.assigned_agent, 'agent-b');
  assert.equal(row.cta_affinity_agent_id, 'agent-b');

  database.close();
});
