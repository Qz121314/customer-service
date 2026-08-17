import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent mobile workspace uses separate inbox and app-like thread surfaces', () => {
  const app = source('../src/dashboard/AgentPortal.tsx');
  const main = source('../src/dashboard/main.tsx');
  const css = source('../src/dashboard/agent-workspace.css');

  assert.ok(
    app.includes("workspace-shell${selectedId ? ' is-thread-open' : ''}"),
  );
  assert.ok(app.includes('className="thread-back-button"'));
  assert.ok(app.includes('aria-label="返回会话列表"'));
  assert.ok(main.includes("'./agent-workspace.css'"));
  assert.ok(!main.includes('setupAgentMobileNavigation'));
  assert.ok(css.includes('.workspace-shell:not(.is-thread-open) .thread-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .conversation-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(css.includes('height: calc(100dvh - env(safe-area-inset-top))'));
  assert.ok(css.includes('grid-template-columns: auto minmax(0, 1fr) auto;'));
  assert.ok(css.includes('.workspace-shell .quick-replies-panel'));
  assert.ok(css.includes('@media (display-mode: standalone)'));
});
