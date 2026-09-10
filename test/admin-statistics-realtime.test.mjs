import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controller = readFileSync(
  'src/dashboard/useAdminStatisticsController.ts',
  'utf8',
);
const dashboardApi = readFileSync('src/dashboard/api.ts', 'utf8');
const adminApi = readFileSync('src/worker/admin-config-api.ts', 'utf8');
const assignmentBroadcast = readFileSync(
  'src/worker/assignment-broadcast.ts',
  'utf8',
);

test('admin statistics use an authenticated realtime delta channel without polling', () => {
  assert.match(dashboardApi, /openAdminStatisticsSocket\(\)/u);
  assert.match(controller, /openAdminStatisticsSocket\(\)/u);
  assert.match(controller, /traffic\.receipt\.created/u);
  assert.doesNotMatch(controller, /setInterval\(/u);
  assert.match(controller, /loadStats\(\{ current: active \}\)/u);
});

test('traffic receipt events reuse the assignment snapshot and do not add a D1 read', () => {
  assert.match(assignmentBroadcast, /broadcastRoom\(env, 'admin-statistics'/u);
  assert.match(assignmentBroadcast, /type: 'traffic\.receipt\.created'/u);
  assert.match(assignmentBroadcast, /conversation\.product_id/u);
  assert.doesNotMatch(assignmentBroadcast, /loadTrafficStatisticsRows/u);
});

test('admin statistics realtime requires the existing admin session', () => {
  const route = adminApi.slice(
    adminApi.indexOf("adminConfigApi.get('/api/admin/realtime/stats'"),
    adminApi.indexOf("adminConfigApi.get('/api/admin/agent-stats'"),
  );
  assert.match(route, /adminAuthorized\(c\)/u);
  assert.match(route, /idFromName\('admin-statistics'\)/u);
});
