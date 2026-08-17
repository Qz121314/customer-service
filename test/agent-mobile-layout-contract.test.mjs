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
  const mobileControls = source('../src/dashboard/agent-mobile-controls.css');

  assert.ok(
    app.includes("workspace-shell${selectedId ? ' is-thread-open' : ''}"),
  );
  assert.ok(app.includes('className="thread-back-button"'));
  assert.ok(app.includes('aria-label="返回会话列表"'));
  assert.ok(main.includes("'./agent-workspace.css'"));
  assert.ok(main.includes("'./agent-mobile-controls.css'"));
  assert.ok(
    main.indexOf("'./agent-mobile-controls.css'") >
      main.indexOf("'./agent-mobile-polish.css'"),
  );
  assert.ok(!main.includes('setupAgentMobileNavigation'));
  assert.ok(css.includes('.workspace-shell:not(.is-thread-open) .thread-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .conversation-pane'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(css.includes('height: calc(100dvh - env(safe-area-inset-top))'));
  assert.ok(css.includes('grid-template-columns: auto minmax(0, 1fr) auto;'));
  assert.ok(css.includes('.workspace-shell .quick-replies-panel'));
  assert.ok(css.includes('@media (display-mode: standalone)'));

  assert.ok(
    mobileControls.includes(
      'grid-template-columns: 40px minmax(0, 1fr) auto;',
    ),
  );
  assert.ok(mobileControls.includes('border-radius: 50%;'));
  assert.ok(mobileControls.includes('appearance: none;'));
  assert.ok(mobileControls.includes('.workspace-shell .composer-tools'));
  assert.ok(mobileControls.includes('align-items: center;'));
  assert.ok(mobileControls.includes('border-radius: 22px;'));
  assert.ok(mobileControls.includes('touch-action: manipulation;'));
});
