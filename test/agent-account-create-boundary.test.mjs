import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const [passwordModule, adminApi, agentApi, app, migration] = await Promise.all([
  readFile(new URL('../src/worker/agent-password.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../src/worker/admin-config-api.ts', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../src/worker/agent-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8'),
  readFile(
    new URL('../migrations/0005_agent_display_name_index.sql', import.meta.url),
    'utf8',
  ),
]);

test('PBKDF2 implementation is shared and passes salt as an ArrayBuffer', () => {
  assert.match(passwordModule, /salt: new Uint8Array\(salt\)\.buffer/u);
  assert.match(adminApi, /hashAgentPassword/u);
  assert.match(agentApi, /verifyAgentPassword/u);
});

test('admin center visibly exposes the employee workspace address', () => {
  assert.match(app, /客服坐席工作台/u);
  assert.match(app, /window\.location\.origin/u);
  assert.match(app, /href="\/agent"/u);
});

test('agent display names are no longer unique identities', () => {
  assert.match(migration, /DROP INDEX IF EXISTS idx_agents_site_name/u);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/u);
});
