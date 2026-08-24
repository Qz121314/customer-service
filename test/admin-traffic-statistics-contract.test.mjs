import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const api = readFileSync('src/worker/admin-config-api.ts', 'utf8');
const dashboardApi = readFileSync('src/dashboard/api.ts', 'utf8');
const portal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const migration = readFileSync(
  'migrations/0040_product_traffic_attribution.sql',
  'utf8',
);

test('traffic receipts retain the product snapshot beyond conversation cleanup', () => {
  assert.match(migration, /ADD COLUMN product_id TEXT/u);
  assert.match(migration, /ADD COLUMN product_title TEXT/u);
  assert.match(migration, /NEW\.product_id/u);
  assert.match(migration, /NEW\.product_title/u);
  assert.doesNotMatch(migration, /DELETE FROM agent_traffic_receipts/u);
});

test('product traffic statistics uses one monthly receipt aggregation', () => {
  const route = api.slice(
    api.indexOf("adminConfigApi.get('/api/admin/product-stats'"),
    api.indexOf("adminConfigApi.get('/api/admin/agent-stats'"),
  );

  assert.match(route, /FROM agent_traffic_receipts/u);
  assert.match(route, /GROUP BY product_id, business_date/u);
  assert.match(route, /business_date >= \?1/u);
  assert.match(route, /business_date <= \?2/u);
  assert.equal((route.match(/\.prepare\(/gu) ?? []).length, 1);
  assert.ok(dashboardApi.includes('request(`/api/admin/product-stats?month='));
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
