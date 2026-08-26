import assert from 'node:assert/strict';
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

const workerDirectory = fileURLToPath(new URL('../src/worker/', import.meta.url));
const sharedDirectory = fileURLToPath(new URL('../src/shared/', import.meta.url));
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
  ({ adminAgentDeleteApi } = await import('../src/worker/admin-agent-delete-api.ts'));
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
  const calls = [];
  return {
    calls,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(input, init) {
            calls.push({ name, input: String(input), body: String(init?.body ?? '') });
            return new Response(null, { status: 204 });
          },
        };
      },
    },
  };
}

function fakeMedia() {
  const deleted = [];
  return {
    deleted,
    bucket: {
      async delete(key) {
        deleted.push(key);
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

test('admin safely deletes an agent while preserving historical reporting', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const rooms = fakeRooms();
  const media = fakeMedia();
  const adminPassword = 'admin-password';
  const env = {
    DB: d1(database),
    MEDIA: media.bucket,
    CONVERSATION_ROOMS: rooms.namespace,
    ADMIN_PASSWORD: adminPassword,
  };

  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, section_id, section_name, is_enabled
    ) VALUES ('default', 'delete-product', 'Delete Product', 'west', 'West', 1);

    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, max_active_conversations, last_seen_at,
      traffic_quota_enabled, traffic_quota_total
    ) VALUES
      ('agent-delete', 'default', 'Delete Agent', 'delete-agent', 'hash', 'salt',
       'online', 1, 5, CURRENT_TIMESTAMP, 1, 100),
      ('agent-fallback', 'default', 'Fallback Agent', 'fallback-agent', 'hash', 'salt',
       'online', 1, 5, CURRENT_TIMESTAMP, 0, 0);

    INSERT INTO agent_routing_scopes (
      site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
    ) VALUES
      ('default', 'agent-delete', 'product', '', '', 'delete-product', 1),
      ('default', 'agent-fallback', 'product', '', '', 'delete-product', 1);

    INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
    VALUES ('delete-session', 'agent-delete', 'delete-token', datetime('now', '+1 day'));

    INSERT INTO agent_push_subscriptions (endpoint, agent_id)
    VALUES ('https://push.invalid/delete', 'agent-delete');

    INSERT INTO agent_quota_adjustments (
      id, site_id, agent_id, request_id, amount,
      quota_total_before, quota_total_after, applied_at
    ) VALUES (
      'delete-quota', 'default', 'agent-delete', 'delete-quota-request',
      100, 0, 100, CURRENT_TIMESTAMP
    );

    INSERT INTO visitors (id, site_id, token_hash)
    VALUES ('delete-visitor', 'default', 'delete-visitor-token');

    INSERT INTO conversations (
      id, site_id, visitor_id, status, product_id, section_id,
      assigned_agent, assigned_at, assigned_business_date, expires_at
    ) VALUES (
      'delete-conversation', 'default', 'delete-visitor', 'pending',
      'delete-product', 'west', 'agent-delete', CURRENT_TIMESTAMP,
      date('now'), datetime('now', '+1 day')
    );

    INSERT INTO agent_daily_stats (
      site_id, agent_id, business_date, conversation_count
    ) VALUES ('default', 'agent-delete', date('now'), 1);

    INSERT INTO agent_traffic_receipts (
      conversation_id, site_id, agent_id, business_date, received_at
    ) VALUES (
      'delete-conversation', 'default', 'agent-delete', date('now'), CURRENT_TIMESTAMP
    );

    INSERT INTO conversation_automation_receipts (
      conversation_id, automation_key, agent_id, outcome
    ) VALUES (
      'delete-conversation', 'delete-test', 'agent-delete', 'skipped'
    );
  `);

  const unauthorized = await adminAgentDeleteApi.request(
    '/api/admin/agents/agent-delete',
    { method: 'DELETE' },
    env,
  );
  assert.equal(unauthorized.status, 401);

  const protectedAdmin = await adminAgentDeleteApi.request(
    '/api/admin/agents/admin',
    {
      method: 'DELETE',
      headers: { cookie: adminCookie(adminPassword) },
    },
    env,
  );
  assert.equal(protectedAdmin.status, 404);

  const response = await adminAgentDeleteApi.request(
    '/api/admin/agents/agent-delete',
    {
      method: 'DELETE',
      headers: { cookie: adminCookie(adminPassword) },
    },
    env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.releasedConversationCount, 1);
  assert.equal(body.reassignedCount, 1);
  assert.equal(
    database.prepare(`SELECT COUNT(*) AS count FROM agents WHERE id = 'agent-delete'`).get()
      .count,
    0,
  );
  assert.equal(
    database
      .prepare(`SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = 'agent-delete'`)
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_routing_scopes WHERE agent_id = 'agent-delete'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_push_subscriptions WHERE agent_id = 'agent-delete'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_quota_adjustments WHERE agent_id = 'agent-delete'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    database
      .prepare(
        `SELECT agent_id FROM conversation_automation_receipts
         WHERE conversation_id = 'delete-conversation' AND automation_key = 'delete-test'`,
      )
      .get().agent_id,
    null,
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT assigned_agent, status FROM conversations
         WHERE id = 'delete-conversation'`,
      )
      .get(),
    Object.assign(Object.create(null), {
      assigned_agent: 'agent-fallback',
      status: 'pending',
    }),
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count FROM agent_daily_stats
         WHERE site_id = 'default' AND agent_id = 'agent-delete'`,
      )
      .get().conversation_count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT agent_id FROM agent_traffic_receipts
         WHERE conversation_id = 'delete-conversation'`,
      )
      .get().agent_id,
    'agent-delete',
  );
  assert.deepEqual(media.deleted, ['agent-avatars/agent-delete/current']);
  assert.ok(
    rooms.calls.some((call) => call.name === 'agent-inbox:agent-delete'),
    'agent inbox realtime should be disconnected',
  );
  assert.ok(
    rooms.calls.some((call) => call.name === 'delete-conversation'),
    'active conversation realtime should be disconnected/broadcast',
  );

  database.close();
});
