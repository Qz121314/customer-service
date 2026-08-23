import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin uses one final management layer while agent styles stay isolated', () => {
  const main = source('../src/dashboard/main.tsx');
  const commercial = source('../src/dashboard/admin-commercial.css');
  const workspace = source('../src/dashboard/agent-workspace.css');

  assert.ok(main.includes('if (isAgentRoute)'));
  assert.ok(main.includes("import('./agent-foundation.css')"));
  assert.ok(main.includes("import('./agent-workspace.css')"));
  assert.ok(main.includes("import('./agent-mobile.css')"));
  assert.ok(main.includes("import('./styles.css')"));
  assert.ok(main.includes("import('./agent-editor.css')"));
  assert.ok(main.includes("import('./admin-commercial.css')"));
  assert.ok(!main.includes("import('./ui-polish.css')"));
  assert.ok(!main.includes("'./dialogue-flow.css'"));
  assert.ok(
    main.indexOf("import('./agent-editor.css')") <
      main.indexOf("import('./admin-commercial.css')"),
  );
  assert.ok(commercial.includes('Final admin console layer'));
  assert.ok(commercial.includes('.admin-list-toolbar'));
  assert.ok(commercial.includes('.statistics-global-summary'));
  assert.equal(workspace.includes('@media (max-width: 760px)'), false);
  assert.equal(workspace.includes('@media (min-width: 761px)'), false);
});

test('final admin layer contains no agent workspace override selectors', () => {
  const commercial = source('../src/dashboard/admin-commercial.css');

  assert.ok(commercial.includes('.admin-content'));
  assert.ok(commercial.includes('.admin-agent-filters'));
  assert.ok(commercial.includes('.traffic-quota-history'));
  assert.ok(!commercial.includes('.workspace-shell'));
  assert.ok(!commercial.includes('.thread-head'));
  assert.ok(!commercial.includes('.conversation-row'));
  assert.ok(!commercial.includes('.messages'));
  assert.ok(!commercial.includes('.composer'));
  assert.ok(!commercial.includes('.availability-pill'));
});
