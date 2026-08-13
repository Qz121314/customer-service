import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const [passwordModule, adminApi, migration, app] = await Promise.all([
  readFile(new URL('../src/worker/agent-password.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../src/worker/admin-config-api.ts', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../migrations/0006_agent_kdf_version.sql', import.meta.url),
    'utf8',
  ),
  readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8'),
]);

test('new agent credentials use a Workers-friendly versioned KDF cost', () => {
  assert.match(passwordModule, /CURRENT_AGENT_PASSWORD_ITERATIONS = 10_000/u);
  assert.match(adminApi, /credentials\.iterations/u);
  assert.match(adminApi, /passwordIterations = credentials\.iterations/u);
  assert.match(migration, /DEFAULT 120000/u);
});

test('admin UI is separated into management navigation and modal editing', () => {
  assert.match(app, /className="admin-console"/u);
  assert.match(app, /客服账号/u);
  assert.match(app, /客服分组/u);
  assert.match(app, /坐席工作台/u);
  assert.match(app, /className="agent-modal"/u);
  assert.doesNotMatch(app, /className="admin-grid"/u);
});
