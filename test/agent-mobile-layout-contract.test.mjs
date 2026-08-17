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
  const baseCss = source('../src/dashboard/agent-workspace.css');
  const mobileCss = source('../src/dashboard/agent-mobile.css');

  assert.ok(
    app.includes("workspace-shell${selectedId ? ' is-thread-open' : ''}"),
  );
  assert.ok(app.includes('className="thread-back-button"'));
  assert.ok(app.includes('aria-label="返回会话列表"'));
  assert.ok(main.includes("'./agent-workspace.css'"));
  assert.ok(main.includes("'./agent-mobile.css'"));
  assert.ok(!main.includes('agent-mobile-polish.css'));
  assert.ok(!main.includes('agent-mobile-controls.css'));
  assert.ok(
    baseCss.includes('.workspace-shell:not(.is-thread-open) .thread-pane'),
  );
  assert.ok(
    baseCss.includes('.workspace-shell.is-thread-open .conversation-pane'),
  );
  assert.ok(baseCss.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(
    baseCss.includes('height: calc(100dvh - env(safe-area-inset-top))'),
  );
  assert.ok(
    mobileCss.includes('grid-template-columns: 40px minmax(0, 1fr) 44px;'),
  );
  assert.ok(!app.includes('quick-replies'));
  assert.ok(!mobileCss.includes('quick-repl'));
  assert.ok(mobileCss.includes('env(safe-area-inset-bottom)'));
  assert.ok(mobileCss.includes('@media (display-mode: standalone)'));
});
