import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAgentOverview } from '../src/dashboard/dashboard-runtime.ts';

test('realtime overview merge preserves the complete agent overview contract', () => {
  const current = {
    open: 0,
    pending: 2,
    closed: 4,
    total: 6,
    todayAccepted: 7,
    dailyLimit: 12,
    trafficQuotaEnabled: true,
    trafficQuotaTotal: 20,
    trafficQuotaUsed: 7,
    trafficQuotaRemaining: 13,
  };
  const realtime = {
    open: 1,
    pending: 2,
    closed: 4,
    total: 7,
    todayAccepted: 8,
    dailyLimit: 12,
    trafficQuotaEnabled: true,
    trafficQuotaTotal: 20,
    trafficQuotaUsed: 8,
    trafficQuotaRemaining: 12,
  };

  assert.deepEqual(mergeAgentOverview(current, realtime), realtime);
});
