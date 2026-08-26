import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
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
const sharedDirectory = fileURLToPath(
  new URL('../src/shared/', import.meta.url),
);
const moduleShims = [];
for (const directory of [workerDirectory, sharedDirectory]) {
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
    const shimPath = join(directory, name.slice(0, -3));
    if (existsSync(shimPath)) continue;
    symlinkSync(name, shimPath);
    moduleShims.push(shimPath);
  }
}

let adminAgentDeleteApi;
try {
  ({ adminAgentDeleteApi } = await import(
    '../src/worker/admin-agent-delete-api.ts',
  ));
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
  const events = new Map();
  return {
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            const payload = JSON.parse(String(init?.body ?? '{}'));
            const current = events.get(name) ?? [];
            current.push(payload);
            events.set(name, current);
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
}

function adminCookie(password) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', password)
    .update(payload)
    .digest('base64url');
  return `cs_session=${payload}.${signature}`;
}

test('admin deletes an agent without deleting historical traffic or chat data', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const rooms = fakeRooms();
  const adminPassword = 'admin-password';

  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, section_id, section_name, is_enabled
    ) VALUES ('default', 'product-west', 'West Product', 'west', 'West', 1);

    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, max_active_conversations, last_seen_at
    ) VALUES
      (
        'agent-delete', 'default', 'Delete Me', 'delete-me', 'hash', 'salt',
        'online', 1, 5, CURRENT_TIMESTAMP
      ),
      (
        'agent-fallback', 'default', 'Fallback', 'fallback', 'hash', 'salt',
        'online', 1, 5, CURRENT_TIMESTAMP
      );

    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id,
      category_id, product_id, is_enabled
    ) VALUES
      ('default', 'agent-delete', 'section', 'west', '', '', 1),
      ('default', 'agent-fallback', 'section', 'west', '', '', 1);

    INSERT INTO agent_products (site_id, agent_id, product_id, is_enabled)
    VALUES ('default', 'agent-delete', 'product-west', 1);

    INSERT INTO group_agents (
      site_id, group_id, agent_id, priority, is_enabled
    ) VALUES ('default', 'general', 'agent-delete', 0, 1);

    INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
    VALUES ('session-delete', 'agent-delete', 'token-delete', datetime('now', '+1 day'));

    INSERT INTO agent_push_subscriptions (endpoint, agent_id)
    VALUES ('https://push.example/delete', 'agent-delete');

    INSERT INTO agent_quota_adjustments (
      id, site_id, agent_id, request_id, amount,
      quota_total_before, quota_total_after, applied_at
    ) VALUES (
      'quota-delete', 'default', 'agent-delete', 'request-delete-001', 10,
      0, 10, CURRENT_TIMESTAMP
    );

    INSERT INTO visitors (
      id, site_id, token_hash, display_name, external_id, expires_at
    ) VALUES (
      'visitor-delete', 'default', 'visitor-token-delete', 'Visitor',
      'ABC123', datetime('now', '+1 day')
    );

    INSERT INTO conversations (
      id, site_id, visitor_id, status, assigned_agent, product_id,
      section_id, product_title, assigned_at, assigned_business_date,
      expires_at, cta_affinity_agent_id, cta_affinity_expires_at
    ) VALUES (
      'conversation-delete', 'default', 'visitor-delete', 'pending',
      'agent-delete', 'product-west', 'west', 'West Product', CURRENT_TIMESTAMP,
      date('now'), datetime('now', '+1 day'), 'agent-delete', datetime('now', '+2 hours')
    );

    INSERT INTO messages (
      id, conversation_id, sender_type, sender_id, body
    ) VALUES (
      'message-delete', 'conversation-delete', 'agent', 'agent-delete',
      'Historical reply'
    );

    INSERT INTO agent_daily_stats (
      site_id, agent_id, business_date, conversation_count
    ) VALUES ('default', 'agent-delete', date('now'), 1)
    ON CONFLICT(site_id, agent_id, business_date) DO UPDATE SET
      conversation_count = 1;

    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, business_date, received_at,
      product_id, product_title
    ) VALUES (
      'conversation-delete', 'default', 'agent-delete', date('now'),
      CURRENT_TIMESTAMP, 'product-west', 'West Product'
    );

    INSERT OR REPLACE INTO conversation_traffic_receipts (
      conversation_id, site_id, business_date, product_id, product_title,
      agent_id, agent_name, started_at
    ) VALUES (
      'conversation-delete', 'default', date('now'), 'product-west',
      'West Product', 'agent-delete', 'Delete Me', CURRENT_TIMESTAMP
    );
  `);

  const response = await adminAgentDeleteApi.request(
    '/api/admin/agents/agent-delete',
    {
      method: 'DELETE',
      headers: { cookie: adminCookie(adminPassword) },
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: rooms.namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.releasedConversationCount, 1);
  assert.equal(payload.reassignedConversationCount, 1);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agents
         WHERE id = 'agent-delete'`,
      )
      .get().count,
    0,
  );

  for (const table of [
    'agent_sessions',
    'agent_push_subscriptions',
    'agent_routing_scopes',
    'agent_products',
    'group_agents',
    'agent_quota_adjustments',
  ]) {
    assert.equal(
      database
        .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE agent_id = ?`)
        .get('agent-delete').count,
      0,
      `${table} should be cleaned with the deleted account`,
    );
  }

  const conversation = database
    .prepare(
      `SELECT assigned_agent, status, cta_affinity_agent_id,
         cta_affinity_expires_at
       FROM conversations
       WHERE id = 'conversation-delete'`,
    )
    .get();
  assert.equal(conversation.assigned_agent, 'agent-fallback');
  assert.equal(conversation.status, 'pending');
  assert.equal(conversation.cta_affinity_agent_id, null);
  assert.equal(conversation.cta_affinity_expires_at, null);

  assert.equal(
    database
      .prepare(
        `SELECT sender_id
         FROM messages
         WHERE id = 'message-delete'`,
      )
      .get().sender_id,
    'agent-delete',
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count
         FROM agent_daily_stats
         WHERE agent_id = 'agent-delete'`,
      )
      .get().conversation_count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT agent_name
         FROM conversation_traffic_receipts
         WHERE conversation_id = 'conversation-delete'`,
      )
      .get().agent_name,
    'Delete Me',
  );

  assert.equal(rooms.events.get('agent-inbox:agent-delete')?.length, 1);
  assert.ok(rooms.events.get('conversation-delete')?.length);
  assert.ok(rooms.events.get('agent-inbox:agent-fallback')?.length);

  database.close();
});
