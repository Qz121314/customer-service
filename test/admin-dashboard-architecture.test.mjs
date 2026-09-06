import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('src/dashboard/AdminShell.tsx', 'utf8');
const portal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const siteSettings = readFileSync('src/dashboard/SiteSettingsPage.tsx', 'utf8');
const diagnostics = readFileSync(
  'src/dashboard/AdminRoutingDiagnoseDock.tsx',
  'utf8',
);
const statisticsController = readFileSync(
  'src/dashboard/useAdminStatisticsController.ts',
  'utf8',
);

test('admin IA owns dashboard, agents and site settings without a statistics destination', () => {
  assert.match(
    shell,
    /export type AdminSection = 'dashboard' \| 'agents' \| 'settings';/u,
  );
  assert.match(shell, /<span>仪表板<\/span>/u);
  assert.match(shell, /<span>客服坐席<\/span>/u);
  assert.match(shell, /<span>站点设置<\/span>/u);
  assert.doesNotMatch(shell, /访客体验/u);
  assert.doesNotMatch(shell, /onSectionChange\('statistics'\)/u);
  assert.doesNotMatch(shell, /<span>流量统计<\/span>/u);
});

test('admin defaults to dashboard and dashboard composes statistics without a context rail', () => {
  assert.match(
    portal,
    /useState<AdminSection>\('dashboard'\)/u,
    'Dashboard should remain the authenticated Admin home',
  );
  assert.match(
    portal,
    /section === 'dashboard'[\s\S]*?<AdminStatisticsPage/u,
    'Dashboard should keep ownership of the existing statistics surface',
  );
  assert.match(
    statisticsController,
    /if \(section !== 'dashboard'\) return;/u,
    'Statistics requests should only run while Dashboard is active',
  );
  assert.match(portal, /: null;[\s\S]*?contextNavigation=/u);
  assert.doesNotMatch(statisticsController, /section !== 'statistics'/u);
});

test('agents owns contextual account and inline routing-diagnostics workspaces', () => {
  assert.match(portal, /type AgentsView = 'accounts' \| 'diagnostics';/u);
  assert.match(portal, /label: '客服账号'/u);
  assert.match(portal, /label: '分流诊断'/u);
  assert.match(
    portal,
    /section === 'agents' && agentsView === 'diagnostics'[\s\S]*?<AdminRoutingDiagnoseWorkspace/u,
  );
  assert.match(diagnostics, /className="routing-diagnose-workspace"/u);
  assert.doesNotMatch(diagnostics, /role="dialog"/u);
  assert.doesNotMatch(diagnostics, /routing-diagnose-backdrop/u);
  assert.doesNotMatch(portal, /routingDiagnoseOpen/u);
  assert.doesNotMatch(portal, /AdminRoutingDiagnoseTrigger/u);
});

test('site settings owns contextual branding and no-agent availability workspaces', () => {
  assert.match(portal, /type SettingsView = 'branding' \| 'availability';/u);
  assert.match(portal, /label: '品牌'/u);
  assert.match(portal, /label: '客服可用性'/u);
  assert.match(portal, /<SiteSettingsPage[\s\S]*?view=\{settingsView\}/u);
  assert.match(siteSettings, /view: 'branding' \| 'availability'/u);
  assert.match(siteSettings, /站点 Logo/u);
  assert.match(siteSettings, /<NoAgentMessageSettingsPanel/u);
  assert.doesNotMatch(portal, /<NoAgentMessageSettingsPanel/u);
});
