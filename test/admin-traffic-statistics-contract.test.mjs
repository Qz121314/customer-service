import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const api = readFileSync('src/worker/admin-config-api.ts', 'utf8');
const dashboardApi = readFileSync('src/dashboard/api.ts', 'utf8');
const portal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const dashboard = readFileSync('src/dashboard/AdminStatisticsPage.tsx', 'utf8');
const migration = readFileSync(
  'migrations/0041_conversation_traffic_reporting.sql',
  'utf8',
);

test('every started conversation receives one durable reporting receipt', () => {
  assert.match(migration, /CREATE TABLE conversation_traffic_receipts/u);
  assert.match(migration, /conversation_id TEXT PRIMARY KEY/u);
  assert.match(migration, /product_id TEXT/u);
  assert.match(migration, /agent_id TEXT/u);
  assert.match(migration, /AFTER INSERT ON conversations/u);
  assert.match(migration, /NEW\.started_business_date/u);
  assert.match(migration, /AFTER INSERT ON agent_traffic_receipts/u);
  assert.match(migration, /WHERE conversation_id = NEW\.conversation_id/u);
  assert.match(migration, /AND agent_id IS NULL/u);
});

test('traffic statistics returns total, agent distribution and product distribution in one query', () => {
  const route = api.slice(
    api.indexOf("adminConfigApi.get('/api/admin/traffic-stats'"),
    api.indexOf("adminConfigApi.get('/api/admin/agent-stats'"),
  );

  assert.match(route, /FROM conversation_traffic_receipts/u);
  assert.match(route, /'summary' AS dimension/u);
  assert.match(route, /'agent' AS dimension/u);
  assert.match(route, /'product' AS dimension/u);
  assert.match(route, /business_date >= \?1/u);
  assert.match(route, /business_date <= \?2/u);
  assert.equal((route.match(/\.prepare\(/gu) ?? []).length, 1);
  assert.match(dashboardApi, /`\/api\/admin\/traffic-stats\?from=/u);
});

test('traffic dashboard answers only the three operational questions', () => {
  for (const label of ['会话总数', '客服接待分布', '产品会话分布']) {
    assert.match(dashboard, new RegExp(label, 'u'));
  }
  for (const obsolete of [
    '产品归因率',
    '数据质量',
    '每日有效会话',
    '本月流量冠军',
    '有流量产品',
  ]) {
    assert.doesNotMatch(dashboard, new RegExp(obsolete, 'u'));
  }
  assert.match(dashboard, /待接待/u);
  assert.match(
    portal,
    /type TrafficRange = 'today' \| 'yesterday' \| '7d' \| '30d' \| '90d'/u,
  );
});

test('seat statistics is demand-loaded for one selected agent', () => {
  const route = api.slice(
    api.indexOf("adminConfigApi.get('/api/admin/agent-stats'"),
    api.indexOf("adminConfigApi.post('/api/admin/agents'"),
  );

  assert.match(route, /c\.req\.query\('agentId'\)/u);
  assert.match(route, /AND agent_id = \?4/u);
  assert.equal((route.match(/\.prepare\(/gu) ?? []).length, 1);
  assert.ok(dashboardApi.includes('&agentId=${encodeURIComponent(agentId)}'));
  assert.ok(!portal.includes('Promise.all(agents.map'));
});
