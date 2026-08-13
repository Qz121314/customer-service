import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const [entry, migration, app, routing] = await Promise.all([
  readFile(new URL('../src/worker/entry.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../migrations/0004_agent_accounts.sql', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/worker/routing.ts', import.meta.url), 'utf8'),
]);

test('management center cannot use legacy admin chat routes', () => {
  assert.match(entry, /app\.all\('\/api\/admin\/conversations'/u);
  assert.match(
    entry,
    /Chat traffic belongs exclusively to authenticated seat accounts/u,
  );
  assert.match(entry, /app\.route\('\/', agentApi\)/u);
});

test('agent accounts have independent credentials and sessions', () => {
  assert.match(migration, /ADD COLUMN username TEXT/u);
  assert.match(migration, /ADD COLUMN password_hash TEXT/u);
  assert.match(migration, /CREATE TABLE agent_sessions/u);
  assert.match(migration, /DELETE FROM group_agents WHERE agent_id = 'admin'/u);
});

test('all seats share one agent login route', () => {
  assert.match(app, /pathname\.startsWith\('\/agent'\)/u);
  assert.match(app, /title="客服登录"/u);
  assert.match(app, /客服管理中心/u);
});

test('routing requires a fresh online heartbeat', () => {
  assert.match(routing, /a\.status = 'online'/u);
  assert.match(
    routing,
    /datetime\(a\.last_seen_at\) >= datetime\('now', '-2 minutes'\)/u,
  );
});

test('newly assigned conversations notify the agent inbox after assignment', () => {
  assert.match(entry, /assignConversationAgent\(c\.env\.DB, conversationId\)/u);
  assert.match(entry, /broadcastAgentInbox\(c\.env, conversationId\)/u);
  assert.match(entry, /idFromName\('admin-inbox'\)/u);
  assert.match(entry, /type: 'conversation\.changed'/u);
});
