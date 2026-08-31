import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const shims = [];
for (const name of [
  'routing.ts',
  'client-api.ts',
  'agent-password.ts',
  'media-api.ts',
  'conversation-retention.ts',
  'assignment-broadcast.ts',
  'abuse-control.ts',
  'no-agent-message.ts',
  'media-store.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}
const calendarShim = join(sharedDirectory, 'calendar-month');
if (!existsSync(calendarShim)) {
  symlinkSync('calendar-month.ts', calendarShim);
  shims.push(calendarShim);
}

let agentApi;
try {
  ({ agentApi } = await import('../src/worker/agent-api.ts'));
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
        const value = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || value === null) return value;
        return value[column] ?? null;
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

test('heartbeat updates activity without changing an offline agent to online', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO agents (
      id, site_id, name, username, password_hash, password_salt,
      status, is_enabled, last_seen_at, daily_conversation_limit,
      traffic_quota_enabled, traffic_quota_total, traffic_quota_used
    ) VALUES (
      'agent-a', 'default', 'Agent A', 'agent-a', 'hash', 'salt',
      'offline', 1, datetime('now', '-10 minutes'), 0, 0, 0, 0
    );
  `);

  const token = 'heartbeat-contract-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES ('session-a', 'agent-a', ?, datetime('now', '+1 hour'))`,
    )
    .run(tokenHash);

  const response = await agentApi.request(
    '/api/agent/auth/heartbeat',
    {
      method: 'POST',
      headers: { Cookie: `cs_agent_session=${token}` },
    },
    { DB: d1(database), CONVERSATION_ROOMS: fakeRooms() },
  );

  assert.equal(response.status, 200);
  assert.equal(
    database.prepare(`SELECT status FROM agents WHERE id = 'agent-a'`).get()
      .status,
    'offline',
  );
  assert.equal(
    database
      .prepare(
        `SELECT datetime(last_seen_at) > datetime('now', '-2 minutes') AS fresh
         FROM agents WHERE id = 'agent-a'`,
      )
      .get().fresh,
    1,
  );

  database.close();
});

test('websocket activity only touches last_seen_at and never rewrites status', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../src/worker/core.ts', import.meta.url)),
    'utf8',
  );
  const match = source.match(
    /private async touchAgent\(agentId: string\): Promise<void> \{([\s\S]*?)\n  \}\n\n  webSocketClose/u,
  );
  assert.ok(match, 'touchAgent implementation must exist');
  assert.match(match[1], /last_seen_at = CURRENT_TIMESTAMP/u);
  assert.doesNotMatch(match[1], /status\s*=/u);
});
