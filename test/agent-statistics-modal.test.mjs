import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent statistics opens inside the workspace instead of navigating away', () => {
  const app = source('../src/dashboard/App.tsx');
  const statistics = source('../src/dashboard/AgentStatisticsWorkspace.tsx');
  const styles = source('../src/dashboard/cloud-service-ui.css');

  assert.ok(app.includes('onClick={() => setStatisticsOpen(true)}'));
  assert.ok(app.includes('<AgentStatisticsModal'));
  assert.ok(!app.includes('href="/agent/stats"'));
  assert.ok(statistics.includes('className="agent-statistics-backdrop"'));
  assert.ok(statistics.includes('aria-modal="true"'));
  assert.ok(statistics.includes("event.key === 'Escape'"));
  assert.ok(styles.includes('grid-template-columns: 82px 360px'));
  assert.ok(styles.includes('width: min(1480px, calc(100% - 24px))'));
});
