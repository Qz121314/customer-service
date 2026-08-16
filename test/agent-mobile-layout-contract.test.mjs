import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent mobile workspace uses separate inbox and thread surfaces', () => {
  const app = source('../src/dashboard/AgentPortal.tsx');
  const css = source('../src/dashboard/agent-workspace.css');

  assert.ok(
    app.includes("workspace-shell${selectedId ? ' is-thread-open' : ''}"),
  );
  assert.ok(app.includes('className="thread-back-button"'));
  assert.ok(app.includes('aria-label="返回会话列表"'));
  assert.ok(css.includes('.workspace-shell:not(.is-thread-open) .thread-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .conversation-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(css.includes('height: calc(100dvh - env(safe-area-inset-top))'));
});
