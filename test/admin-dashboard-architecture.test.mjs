import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('src/dashboard/AdminShell.tsx', 'utf8');
const portal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const siteSettings = readFileSync('src/dashboard/SiteSettingsPage.tsx', 'utf8');
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

test('admin defaults to dashboard and dashboard composes statistics', () => {
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
  assert.doesNotMatch(statisticsController, /section !== 'statistics'/u);
});

test('site settings owns branding and the existing no-agent message setting', () => {
  assert.match(portal, /: '站点设置';/u);
  assert.match(portal, /管理站点品牌和访客侧客服体验。/u);
  assert.match(portal, /<SiteSettingsPage/u);
  assert.match(siteSettings, /站点品牌/u);
  assert.match(siteSettings, /站点 Logo/u);
  assert.match(siteSettings, /客服可用性/u);
  assert.match(siteSettings, /<NoAgentMessageSettingsPanel/u);
  assert.doesNotMatch(portal, /<NoAgentMessageSettingsPanel/u);
});
