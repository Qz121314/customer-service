import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent login keeps account and access-key fields out of credential autofill', () => {
  const ui = source('../src/dashboard/dashboard-ui.tsx');
  const agentLogin = ui.slice(
    ui.indexOf('function AgentLogin'),
    ui.indexOf('function AuthPage'),
  );

  for (const contract of [
    'name="agent-account"',
    'name="agent-access-key"',
    'autoComplete="off"',
    'autoComplete="new-password"',
    'data-form-type="other"',
    'data-1p-ignore="true"',
    'data-lpignore="true"',
  ]) {
    assert.ok(agentLogin.includes(contract), contract);
  }

  for (const removed of [
    'autoComplete="username"',
    'autoComplete="current-password"',
    'autoFocus',
    'readOnly',
  ]) {
    assert.ok(!agentLogin.includes(removed), removed);
  }
});
