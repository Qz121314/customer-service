import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent workspace uses one responsive commercial stylesheet', () => {
  const main = source('../src/dashboard/main.tsx');
  const css = source('../src/dashboard/agent-workspace.css');

  assert.ok(main.includes("'./agent-workspace.css'"));
  assert.ok(
    main.indexOf("'./agent-workspace.css'") > main.indexOf("'./ui-polish.css'"),
  );
  assert.ok(!main.includes('agent-mobile-layout.css'));
  assert.ok(!main.includes('agent-mobile-thread.css'));
  assert.ok(!main.includes('agent-mobile-composer.css'));
  assert.ok(!main.includes('setupAgentMobileNavigation'));
  assert.match(
    css,
    /grid-template-columns:\s*80px minmax\(330px, 380px\) minmax\(0, 1fr\)/u,
  );
  assert.match(css, /--agent-accent:\s*#ff5a1f/u);
  assert.ok(css.includes('@media (max-width: 760px)'));
  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));
  assert.ok(css.includes('bottom: calc(66px + env(safe-area-inset-bottom));'));
});
