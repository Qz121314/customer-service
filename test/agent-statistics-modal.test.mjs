import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent statistics opens inside the workspace instead of navigating away', () => {
  const portal = source('../src/dashboard/AgentPortal.tsx');
  const panels = source('../src/dashboard/AgentWorkspacePanels.tsx');
  const chrome = source('../src/dashboard/AgentWorkspaceChrome.tsx');
  const app = `${portal}\n${panels}\n${chrome}`;
  const statistics = source('../src/dashboard/AgentStatisticsWorkspace.tsx');

  assert.ok(app.includes('setStatisticsOpen(true)'));
  assert.ok(app.includes('<AgentStatisticsModal'));
  assert.ok(!app.includes('href="/agent/stats"'));
  assert.ok(statistics.includes('aria-modal="true"'));
  assert.ok(statistics.includes("event.key === 'Escape'"));
});

test('admin statistics remains a first-class page rather than a modal', () => {
  const portal = source('../src/dashboard/AdminPortal.tsx');
  const statistics = source('../src/dashboard/AdminStatisticsPage.tsx');
  const app = `${portal}\n${statistics}`;

  assert.ok(portal.includes("setSection('statistics')"));
  assert.ok(portal.includes("section === 'statistics'"));
  assert.ok(portal.includes('<AdminStatisticsPage'));
  assert.ok(statistics.includes('aria-label="选择客服坐席"'));
  assert.ok(!app.includes('className="admin-statistics-modal"'));
  assert.ok(!statistics.includes('aria-modal="true"'));
});
