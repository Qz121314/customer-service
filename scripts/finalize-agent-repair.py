from pathlib import Path

admin = Path('src/worker/admin-config-api.ts')
s = admin.read_text()
s = s.replace("import {\n  CURRENT_AGENT_PASSWORD_ITERATIONS,\n  hashAgentPassword,\n} from './agent-password';", "import { hashAgentPassword } from './agent-password';")
s = s.replace("  if (credentials.iterations !== CURRENT_AGENT_PASSWORD_ITERATIONS) {\n    return c.json({ error: 'AGENT_CREATE_FAILED' }, 500);\n  }\n\n", "")
s = s.replace("    passwordHash = credentials.hash;\n    passwordSalt = credentials.salt;\n  }", "    passwordHash = credentials.hash;\n    passwordSalt = credentials.salt;\n    passwordIterations = credentials.iterations;\n  }", 1)
old = "  await c.env.DB.batch(statements);\n  return c.json({ ok: true, id }, 201);"
new = "  try {\n    await c.env.DB.batch(statements);\n  } catch (error) {\n    console.error('agent.create.failed', error);\n    if (String(error).includes('idx_agents_username')) {\n      return c.json({ error: 'USERNAME_EXISTS' }, 409);\n    }\n    return c.json({ error: 'AGENT_CREATE_FAILED' }, 500);\n  }\n  return c.json({ ok: true, id }, 201);"
if old not in s:
    raise SystemExit('create batch marker not found')
s = s.replace(old, new, 1)
admin.write_text(s)

Path('test/agent-create-runtime-boundary.test.mjs').write_text("""import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const [passwordModule, adminApi, migration, app] = await Promise.all([
  readFile(new URL('../src/worker/agent-password.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/worker/admin-config-api.ts', import.meta.url), 'utf8'),
  readFile(new URL('../migrations/0006_agent_kdf_version.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8'),
]);

test('new agent credentials use a Workers-friendly versioned KDF cost', () => {
  assert.match(passwordModule, /CURRENT_AGENT_PASSWORD_ITERATIONS = 10_000/u);
  assert.match(adminApi, /credentials\.iterations/u);
  assert.match(adminApi, /passwordIterations = credentials\.iterations/u);
  assert.match(migration, /DEFAULT 120000/u);
});

test('admin UI is separated into management navigation and modal editing', () => {
  assert.match(app, /className=\"admin-console\"/u);
  assert.match(app, /客服账号/u);
  assert.match(app, /客服分组/u);
  assert.match(app, /坐席工作台/u);
  assert.match(app, /className=\"agent-modal\"/u);
});
""")
