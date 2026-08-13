import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [adminApi, agentApi, app, migration] = await Promise.all([
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

test('PBKDF2 salt is passed as an ArrayBuffer in both account paths', () => {
  assert.match(adminApi, /salt: new Uint8Array\(salt\)\.buffer/u);
  assert.match(agentApi, /salt: new Uint8Array\(salt\)\.buffer/u);
});

test('admin center visibly exposes the employee workspace address', () => {
  assert.match(app, /客服坐席工作台/u);
  assert.match(app, /window\.location\.origin}\/agent/u);
});

test('agent display names are no longer unique identities', () => {
  assert.match(migration, /DROP INDEX IF EXISTS idx_agents_site_name/u);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX/u);
});
