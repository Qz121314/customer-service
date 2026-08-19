import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin polish stays on the admin route while agent styles are isolated', () => {
  const main = source('../src/dashboard/main.tsx');
  const polish = source('../src/dashboard/ui-polish.css');
  const workspace = source('../src/dashboard/agent-workspace.css');

  assert.ok(main.includes('if (isAgentRoute)'));
  assert.ok(main.includes("import('./agent-foundation.css')"));
  assert.ok(main.includes("import('./agent-workspace.css')"));
  assert.ok(main.includes("import('./agent-mobile.css')"));
  assert.ok(main.includes("import('./ui-polish.css')"));
  assert.ok(main.includes("import('./styles.css')"));
  assert.ok(!main.includes("'./dialogue-flow.css'"));
  assert.ok(
    polish.includes('grid-template-columns: repeat(4, minmax(0, 1fr));'),
  );
  assert.ok(polish.includes('overflow-y: auto;'));
  assert.equal(workspace.includes('@media (max-width: 760px)'), false);
  assert.equal(workspace.includes('@media (min-width: 761px)'), false);
});

test('admin polish contains no agent workspace override layer', () => {
  const polish = source('../src/dashboard/ui-polish.css');

  assert.ok(polish.includes('Admin-only layout refinement layer'));
  assert.ok(polish.includes('.admin-content'));
  assert.ok(polish.includes('.agent-editor-form'));
  assert.ok(polish.includes('.traffic-quota-editor'));
  assert.ok(!polish.includes('.workspace-shell'));
  assert.ok(!polish.includes('.thread-head'));
  assert.ok(!polish.includes('.conversation-row'));
  assert.ok(!polish.includes('.messages'));
  assert.ok(!polish.includes('.composer'));
  assert.ok(!polish.includes('.availability-pill'));
});
