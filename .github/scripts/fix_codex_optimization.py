from pathlib import Path

payload_test = Path('test/realtime-payload.test.mjs')
if payload_test.exists():
    payload_test.unlink()

Path('test/realtime-contract.test.mjs').write_text(
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

const clientApi = readFileSync(new URL('../src/worker/client-api.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8');

test('realtime protocol carries deltas instead of forcing REST refreshes', () => {
  assert.ok(clientApi.includes('conversation: conversationSummary(conversation)'));
  assert.ok(clientApi.includes('message?: Record<string, unknown>'));
  assert.ok(clientApi.includes('overview,'));
  assert.ok(dashboard.includes("payload.type === 'message' && payload.message"));
  assert.ok(dashboard.includes('setMediaItems('));
});
""",
    encoding='utf-8',
)
