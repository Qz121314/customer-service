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
  const statisticsStyles = source('../src/dashboard/agent-statistics.css');
  const desktopStyles = source('../src/dashboard/agent-desktop.css');
  const mobileStyles = source('../src/dashboard/agent-mobile.css');

  assert.ok(app.includes('setStatisticsOpen(true)'));
  assert.ok(app.includes('<AgentStatisticsModal'));
  assert.ok(!app.includes('href="/agent/stats"'));
  assert.ok(statistics.includes('className="agent-statistics-backdrop"'));
  assert.ok(statistics.includes('aria-modal="true"'));
  assert.ok(statistics.includes("event.key === 'Escape'"));
  assert.ok(statisticsStyles.includes('.agent-statistics-backdrop'));
  assert.ok(statisticsStyles.includes('.agent-statistics-dialog'));
  assert.ok(app.includes('className="workspace-sidebar-actions"'));
  assert.ok(panels.includes('<AgentActionToolbar'));
  assert.ok(
    desktopStyles.includes('.workspace-shell .workspace-sidebar-actions'),
  );
  assert.ok(desktopStyles.includes('margin-top: auto'));
  assert.ok(mobileStyles.includes('.workspace-sidebar-actions'));
});

test('admin statistics opens as a first-class page with a wrapped day grid', () => {
  const portal = source('../src/dashboard/AdminPortal.tsx');
  const statistics = source('../src/dashboard/AdminStatisticsPage.tsx');
  const styles = source('../src/dashboard/admin-commercial.css');
  const app = `${portal}\n${statistics}`;

  assert.ok(portal.includes("setSection('statistics')"));
  assert.ok(portal.includes("section === 'statistics'"));
  assert.ok(portal.includes('<AdminStatisticsPage'));
  assert.ok(statistics.includes('className="admin-statistics-page"'));
  assert.ok(statistics.includes('aria-label="选择客服坐席"'));
  assert.ok(statistics.includes('className="statistics-seat-layout"'));
  assert.ok(statistics.includes('className="statistics-seat-detail"'));
  assert.ok(statistics.includes('className="statistics-day-grid"'));
  assert.ok(!app.includes('className="admin-statistics-modal"'));
  assert.ok(!statistics.includes('aria-modal="true"'));
  assert.ok(styles.includes('.admin-statistics-page .statistics-seat-layout'));
});
