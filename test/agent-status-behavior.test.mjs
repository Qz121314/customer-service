import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import test from 'node:test';
import { touchAgentActivity } from '../src/worker/agent-activity.ts';
import { hashAgentPassword } from '../src/worker/agent-password.ts';

const repositoryDirectory = fileURLToPath(new URL('../', import.meta.url));

function copyTypeScriptDirectory(runtimeDirectory, relativeDirectory) {
  const sourceDirectory = join(repositoryDirectory, relativeDirectory);
  const targetDirectory = join(runtimeDirectory, relativeDirectory);
  mkdirSync(targetDirectory, { recursive: true });

  for (const name of readdirSync(sourceDirectory)) {
    if (!name.endsWith('.ts')) continue;
    const sourcePath = join(sourceDirectory, name);
    const targetPath = join(targetDirectory, name);
    const shimPath = join(targetDirectory, name.slice(0, -3));
    copyFileSync(sourcePath, targetPath);
    symlinkSync(name, shimPath);
  }
}

function createIsolatedTypeScriptRuntime() {
  const runtimeDirectory = mkdtempSync(
    join(repositoryDirectory, '.agent-status-runtime-'),
  );
  copyTypeScriptDirectory(runtimeDirectory, 'src/worker');
  copyTypeScriptDirectory(runtimeDirectory, 'src/shared');
  return runtimeDirectory;
}

const runtimeDirectory = createIsolatedTypeScriptRuntime();
const agentApiUrl = pathToFileURL(
  join(runtimeDirectory, 'src/worker/agent-api.ts'),
).href;
let agentApi;
try {
  ({ agentApi } = await import(agentApiUrl));
} finally {
  rmSync(runtimeDirectory, { recursive: true, force: true });
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

function fakeRooms(requests = []) {
  return {
    idFromName(name) {
      return name;
    },
    get(name) {
      return {
        async fetch(url, init) {
          requests.push({ name, url: String(url), init });
          return new Response(null, { status: 204 });
        },
      };
    },
  };
}

async function setAgentPassword(database, id, password) {
  const credential = await hashAgentPassword(password);
  database
    .prepare(
      `UPDATE agents
       SET password_hash = ?, password_salt = ?, password_iterations = ?
       WHERE id = ?`,
    )
    .run(credential.hash, credential.salt, credential.iterations, id);
}

function seedAgent(database, id, status) {
  database
    .prepare(
      `INSERT INTO agents (
        id, site_id, name, username, password_hash, password_salt,
        status, is_enabled, last_seen_at, daily_conversation_limit,
        traffic_quota_enabled, traffic_quota_total, traffic_quota_used
      ) VALUES (?, 'default', ?, ?, 'hash', 'salt', ?, 1,
        datetime('now', '-10 minutes'), 0, 0, 0, 0)`,
    )
    .run(id, id, id, status);
}

test('realtime activity touch preserves online, busy, and offline business status', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-online', 'online');
  seedAgent(database, 'agent-busy', 'busy');
  seedAgent(database, 'agent-offline', 'offline');

  for (const id of ['agent-online', 'agent-busy', 'agent-offline']) {
    await touchAgentActivity(d1(database), id);
  }

  assert.deepEqual(
    database
      .prepare(
        `SELECT id, status FROM agents
         WHERE id LIKE 'agent-%'
         ORDER BY id ASC`,
      )
      .all()
      .map((row) => [row.id, row.status]),
    [
      ['agent-busy', 'busy'],
      ['agent-offline', 'offline'],
      ['agent-online', 'online'],
    ],
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agents
         WHERE id LIKE 'agent-%'
           AND datetime(last_seen_at) > datetime('now', '-2 minutes')`,
      )
      .get().count,
    3,
  );

  database.close();
});

test('heartbeat updates activity without changing an offline agent to online', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-a', 'offline');

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

test('first device login sets online while another device login preserves busy', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-multi-login', 'offline');
  await setAgentPassword(database, 'agent-multi-login', 'secret');
  const env = { DB: d1(database), CONVERSATION_ROOMS: fakeRooms() };

  const login = () =>
    agentApi.request(
      '/api/agent/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'agent-multi-login',
          password: 'secret',
        }),
      },
      env,
    );

  const desktop = await login();
  assert.equal(desktop.status, 200);
  assert.equal((await desktop.json()).agent.status, 'online');
  database
    .prepare(`UPDATE agents SET status = 'busy' WHERE id = ?`)
    .run('agent-multi-login');

  const phone = await login();
  assert.equal(phone.status, 200);
  assert.equal((await phone.json()).agent.status, 'busy');
  assert.equal(
    database
      .prepare(`SELECT status FROM agents WHERE id = ?`)
      .get('agent-multi-login').status,
    'busy',
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?`,
      )
      .get('agent-multi-login').count,
    2,
  );

  database.close();
});

test('device logout preserves other sessions and only the final logout disconnects realtime', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-multi-logout', 'busy');
  const desktopToken = 'desktop-session-token';
  const phoneToken = 'phone-session-token';
  for (const [id, token] of [
    ['desktop-session', desktopToken],
    ['phone-session', phoneToken],
  ]) {
    database
      .prepare(
        `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
         VALUES (?, 'agent-multi-logout', ?, datetime('now', '+1 hour'))`,
      )
      .run(id, createHash('sha256').update(token).digest('hex'));
  }
  const realtimeRequests = [];
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms(realtimeRequests),
  };

  const phoneLogout = await agentApi.request(
    '/api/agent/auth/logout',
    {
      method: 'POST',
      headers: { Cookie: `cs_agent_session=${phoneToken}` },
    },
    env,
  );
  assert.equal(phoneLogout.status, 200);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?`,
      )
      .get('agent-multi-logout').count,
    1,
  );
  assert.equal(
    database
      .prepare(`SELECT status FROM agents WHERE id = ?`)
      .get('agent-multi-logout').status,
    'busy',
  );
  assert.equal(realtimeRequests.length, 0);

  const desktopSession = await agentApi.request(
    '/api/agent/auth/session',
    { headers: { Cookie: `cs_agent_session=${desktopToken}` } },
    env,
  );
  assert.equal((await desktopSession.json()).authenticated, true);

  const desktopLogout = await agentApi.request(
    '/api/agent/auth/logout',
    {
      method: 'POST',
      headers: { Cookie: `cs_agent_session=${desktopToken}` },
    },
    env,
  );
  assert.equal(desktopLogout.status, 200);
  assert.equal(
    database
      .prepare(`SELECT status FROM agents WHERE id = ?`)
      .get('agent-multi-logout').status,
    'offline',
  );
  assert.equal(realtimeRequests.length, 1);
  assert.equal(realtimeRequests[0].name, 'agent-inbox:agent-multi-logout');
  assert.match(realtimeRequests[0].url, /disconnect-agent$/u);

  database.close();
});

test('availability changes broadcast the shared business status to every device', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-availability', 'online');
  const token = 'availability-session-token';
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES ('availability-session', 'agent-availability', ?, datetime('now', '+1 hour'))`,
    )
    .run(createHash('sha256').update(token).digest('hex'));
  const realtimeRequests = [];
  const pendingTasks = [];
  const response = await agentApi.request(
    '/api/agent/auth/status',
    {
      method: 'POST',
      headers: {
        Cookie: `cs_agent_session=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'busy' }),
    },
    { DB: d1(database), CONVERSATION_ROOMS: fakeRooms(realtimeRequests) },
    { waitUntil: (task) => pendingTasks.push(task) },
  );
  assert.equal(response.status, 200);
  await Promise.all(pendingTasks);
  assert.equal(realtimeRequests.length, 1);
  const payload = JSON.parse(realtimeRequests[0].init.body);
  assert.equal(realtimeRequests[0].name, 'agent-inbox:agent-availability');
  assert.equal(payload.type, 'agent.availability.changed');
  assert.equal(payload.agentId, 'agent-availability');
  assert.equal(payload.availability, 'busy');
  assert.match(payload.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);

  database.close();
});

test('explicit revoke-all invalidates every device and disconnects realtime', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  seedAgent(database, 'agent-revoke-all', 'online');
  const tokens = ['revoke-desktop-token', 'revoke-phone-token'];
  for (const [index, token] of tokens.entries()) {
    database
      .prepare(
        `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
         VALUES (?, 'agent-revoke-all', ?, datetime('now', '+1 hour'))`,
      )
      .run(
        `revoke-session-${index}`,
        createHash('sha256').update(token).digest('hex'),
      );
  }
  const realtimeRequests = [];
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms(realtimeRequests),
  };

  const response = await agentApi.request(
    '/api/agent/auth/revoke-all',
    {
      method: 'POST',
      headers: { Cookie: `cs_agent_session=${tokens[0]}` },
    },
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?`,
      )
      .get('agent-revoke-all').count,
    0,
  );
  assert.equal(
    database
      .prepare(`SELECT status FROM agents WHERE id = ?`)
      .get('agent-revoke-all').status,
    'offline',
  );
  assert.equal(realtimeRequests.length, 1);
  assert.equal(realtimeRequests[0].name, 'agent-inbox:agent-revoke-all');

  for (const token of tokens) {
    const session = await agentApi.request(
      '/api/agent/auth/session',
      { headers: { Cookie: `cs_agent_session=${token}` } },
      env,
    );
    assert.equal((await session.json()).authenticated, false);
  }

  database.close();
});
