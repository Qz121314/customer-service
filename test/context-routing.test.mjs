import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { resolveConversationGroup } from '../src/worker/context-routing.ts';
import { assignConversationAgent } from '../src/worker/routing.ts';

function d1(database) {
  return {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) {
          bindings = values;
          return this;
        },
        async first() {
          return database.prepare(sql).get(...bindings) ?? null;
        },
        async run() {
          const result = database.prepare(sql).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

function createRoutingDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE support_groups (
      site_id TEXT NOT NULL,
      id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      PRIMARY KEY (site_id, id)
    );
    CREATE TABLE group_routing_rules (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      section_id TEXT NOT NULL DEFAULT '',
      category_id TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  for (const id of ['category', 'section', 'default', 'legacy']) {
    database
      .prepare(
        'INSERT INTO support_groups (site_id, id, is_enabled) VALUES (?, ?, 1)',
      )
      .run('default', id);
  }
  database.exec(`
    INSERT INTO group_routing_rules (
      id, site_id, group_id, section_id, category_id, is_default, is_enabled
    ) VALUES
      ('rule-category', 'default', 'category', 'section-a', 'category-a', 0, 1),
      ('rule-section', 'default', 'section', 'section-a', '', 0, 1),
      ('rule-default', 'default', 'default', '', '', 1, 1);
  `);
  return database;
}

test('demand routing prefers category, then section, then default group', async () => {
  const database = createRoutingDatabase();
  const db = d1(database);

  assert.equal(
    await resolveConversationGroup(
      db,
      'default',
      { sectionId: 'section-a', categoryId: 'category-a' },
      'legacy',
    ),
    'category',
  );
  assert.equal(
    await resolveConversationGroup(
      db,
      'default',
      { sectionId: 'section-a', categoryId: 'category-other' },
      'legacy',
    ),
    'section',
  );
  assert.equal(
    await resolveConversationGroup(
      db,
      'default',
      { sectionId: 'section-other', categoryId: null },
      'legacy',
    ),
    'default',
  );

  database.close();
});

test('legacy group is used only when no context rule matches', async () => {
  const database = createRoutingDatabase();
  database.exec('DELETE FROM group_routing_rules');

  assert.equal(
    await resolveConversationGroup(
      d1(database),
      'default',
      { sectionId: 'section-a', categoryId: 'category-a' },
      'legacy',
    ),
    'legacy',
  );

  database.close();
});

test('eligible agents receive new conversations in round-robin order', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE support_groups (
      site_id TEXT NOT NULL,
      id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      PRIMARY KEY (site_id, id)
    );
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      password_hash TEXT,
      status TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      max_active_conversations INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      last_assigned_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE group_agents (
      site_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      is_enabled INTEGER NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      group_id TEXT,
      assigned_agent TEXT,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    INSERT INTO support_groups VALUES ('default', 'sales', 1);
    INSERT INTO agents (
      id, site_id, name, username, password_hash, status, is_enabled,
      max_active_conversations, last_seen_at, last_assigned_at
    ) VALUES
      ('agent-a', 'default', 'A', 'a', 'hash-a', 'online', 1, 0,
       CURRENT_TIMESTAMP, '2026-01-01T00:00:00.000Z'),
      ('agent-b', 'default', 'B', 'b', 'hash-b', 'online', 1, 0,
       CURRENT_TIMESTAMP, NULL);
    INSERT INTO group_agents VALUES
      ('default', 'sales', 'agent-a', 1),
      ('default', 'sales', 'agent-b', 1);
    INSERT INTO conversations (
      id, site_id, group_id, assigned_agent, status, expires_at, created_at
    ) VALUES
      ('conversation-1', 'default', 'sales', NULL, 'open',
       '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP),
      ('conversation-2', 'default', 'sales', NULL, 'open',
       '2099-01-01T00:00:00.000Z', CURRENT_TIMESTAMP);
  `);

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');

  assert.equal(first?.id, 'agent-b');
  assert.equal(second?.id, 'agent-a');
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get('conversation-1').assigned_agent,
    'agent-b',
  );
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get('conversation-2').assigned_agent,
    'agent-a',
  );

  database.close();
});
