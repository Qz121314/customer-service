import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent login stays focused and commercially styled', () => {
  const ui = source('../src/dashboard/dashboard-ui.tsx');
  const css = source('../src/dashboard/agent-foundation.css');
  const agentLogin = ui.slice(
    ui.indexOf('function AgentLogin'),
    ui.indexOf('function AuthPage'),
  );

  for (const contract of [
    'title="客服工作台" variant="agent"',
    'className="auth-form agent-auth-form"',
    'className="primary-button agent-login-button"',
    'autoComplete="off"',
    'autoComplete="new-password"',
    'readOnly={!credentialsUnlocked}',
    'data-form-type="other"',
  ]) {
    assert.ok(agentLogin.includes(contract), contract);
  }

  for (const removed of [
    'AGENT WORKSPACE',
    '所有客服使用同一个入口，登录后只进入自己的会话工作台。',
    '返回管理中心',
  ]) {
    assert.ok(!ui.includes(removed), removed);
  }

  for (const removed of [
    'autoComplete="username"',
    'autoComplete="current-password"',
    'autoFocus',
  ]) {
    assert.ok(!agentLogin.includes(removed), removed);
  }

  for (const contract of [
    '.agent-auth-page',
    'background: #080b12;',
    'background-image:',
    '.agent-auth-card',
    '.agent-auth-form input:focus',
    '.agent-login-button',
    '@media (max-width: 520px)',
  ]) {
    assert.ok(css.includes(contract), contract);
  }
});
