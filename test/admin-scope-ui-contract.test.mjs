import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin UI presents dynamic routing scopes instead of expanded product lists', () => {
  const app = source('../src/dashboard/App.tsx');
  const api = source('../src/dashboard/api.ts');
  const styles = source('../src/dashboard/styles.css');

  assert.ok(app.includes('<th>负责范围</th>'));
  assert.ok(app.includes('agentScopeSummary('));
  assert.ok(app.includes('整个分区'));
  assert.ok(app.includes('动态覆盖'));
  assert.ok(!app.includes('<th>负责产品</th>'));
  assert.ok(api.includes('routingScope: scope'));
  assert.ok(styles.includes('width: min(780px, 100%)'));
  assert.ok(
    styles.includes('grid-template-columns: repeat(2, minmax(0, 1fr))'),
  );
  assert.ok(app.includes('aria-modal="true"'));
  assert.ok(app.includes('再配置它的分流负责范围'));
  assert.ok(!app.includes('分配负责产品'));
});
