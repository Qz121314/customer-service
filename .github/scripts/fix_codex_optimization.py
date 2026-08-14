from pathlib import Path

payload_test = Path('test/realtime-payload.test.mjs')
if payload_test.exists():
    payload_test.unlink()

Path('test/realtime-contract.test.mjs').write_text(
    """import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clientApi = readFileSync(new URL('../src/worker/client-api.ts', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8');

test('realtime protocol carries deltas instead of forcing REST refreshes', () => {
  assert.match(clientApi, /conversation:\s*conversationSummary\(conversation\)/u);
  assert.match(clientApi, /message\?:\s*Record<string, unknown>/u);
  assert.match(clientApi, /overview,\s*\n\s*\}\);/u);
  assert.match(dashboard, /payload\.type === 'message' && payload\.message/u);
  assert.match(dashboard, /setMediaItems\(/u);
});
""",
    encoding='utf-8',
)
