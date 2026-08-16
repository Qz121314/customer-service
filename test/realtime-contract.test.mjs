import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const clientApi = readFileSync(
  new URL('../src/worker/client-api.ts', import.meta.url),
  'utf8',
);
const dashboard = readFileSync(
  new URL('../src/dashboard/AgentPortal.tsx', import.meta.url),
  'utf8',
);

test('realtime protocol carries deltas instead of forcing REST refreshes', () => {
  assert.ok(
    clientApi.includes('conversation: conversationSummary(conversation)'),
  );
  assert.ok(clientApi.includes('message?: Record<string, unknown>'));
  assert.ok(clientApi.includes('overview,'));
  assert.ok(
    dashboard.includes("payload.type === 'message' && payload.message"),
  );
  assert.ok(dashboard.includes('setMediaItems('));
  assert.ok(!dashboard.includes('setInterval(beat, 30_000)'));
  assert.ok(dashboard.includes('void heartbeat()'));
});
