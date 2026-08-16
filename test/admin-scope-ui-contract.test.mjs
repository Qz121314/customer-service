import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin UI presents dynamic routing scopes instead of expanded product lists', () => {
  const admin = source('../src/dashboard/AdminPortal.tsx');
  const editor = source('../src/dashboard/AgentEditorModal.tsx');
  const adminUi = `${admin}\n${editor}`;
  const runtime = source('../src/dashboard/dashboard-runtime.ts');
  const api = source('../src/dashboard/api.ts');
  const styles = source('../src/dashboard/styles.css');
  const visualStyles = source('../src/dashboard/cloud-service-ui.css');

  assert.ok(admin.includes('<th>负责范围</th>'));
  assert.ok(admin.includes('agentScopeSummary('));
  assert.ok(runtime.includes('整个分区'));
  assert.ok(runtime.includes('动态覆盖'));
  assert.ok(!admin.includes('<th>负责产品</th>'));
  assert.ok(api.includes('routingScope: normalizeRoutingScope('));
  assert.ok(styles.includes('width: min(780px, 100%)'));
  assert.ok(visualStyles.includes('width: min(1200px, 100%)'));
  assert.ok(
    visualStyles.includes('grid-template-columns: 410px minmax(0, 1fr)'),
  );
  assert.ok(
    styles.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'),
  );
  assert.ok(adminUi.includes('aria-modal="true"'));
  assert.ok(adminUi.includes('再配置它的分流负责范围'));
  assert.ok(!adminUi.includes('分配负责产品'));
});
