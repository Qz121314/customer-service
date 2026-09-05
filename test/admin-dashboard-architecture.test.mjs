import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync('src/dashboard/AdminShell.tsx', 'utf8');
const portal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const statisticsController = readFileSync(
  'src/dashboard/useAdminStatisticsController.ts',
  'utf8',
);

test('admin IA owns dashboard, agents and settings without a statistics destination', () => {
  assert.match(
    shell,
    /export type AdminSection = 'dashboard' \| 'agents' \| 'settings';/u,
  );
  assert.match(shell, /<span>仪表板<\/span>/u);
  assert.match(shell, /<span>客服坐席<\/span>/u);
  assert.match(shell, /<span>访客体验<\/span>/u);
  assert.doesNotMatch(shell, /onSectionChange\('statistics'\)/u);
  assert.doesNotMatch(shell, /<span>流量统计<\/span>/u);
});

test('admin defaults to dashboard and dashboard composes statistics', () => {
  assert.match(
    portal,
    /useState<AdminSection>\('dashboard'\)/u,
    'Dashboard should be the authenticated Admin home',
  );
  assert.match(
    portal,
    /section === 'dashboard'[\s\S]*?<AdminStatisticsPage/u,
    'Dashboard should own the existing statistics surface',
  );
  assert.match(
    statisticsController,
    /if \(section !== 'dashboard'\) return;/u,
    'Statistics requests should only run while Dashboard is active',
  );
  assert.doesNotMatch(statisticsController, /section !== 'statistics'/u);
});
