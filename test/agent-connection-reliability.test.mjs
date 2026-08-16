import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { realtimeReconnectDelay } from '../src/dashboard/api.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('realtime reconnect uses capped exponential backoff with jitter', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 8].map((attempt) => realtimeReconnectDelay(attempt, 0.5)),
    [1000, 2000, 4000, 8000, 15000, 15000],
  );
  assert.equal(realtimeReconnectDelay(4, 0), 12000);
  assert.equal(realtimeReconnectDelay(4, 1), 18000);
});

test('agent workspace exposes explicit connection states and delta recovery', async () => {
  const [app, api, worker, media] = await Promise.all([
    read('../src/dashboard/AgentPortal.tsx'),
    read('../src/dashboard/api.ts'),
    read('../src/worker/agent-api.ts'),
    read('../src/dashboard/agent-media.ts'),
  ]);

  assert.match(app, /网络已断开 · 草稿已保存/u);
  assert.match(app, /连接中断 · 正在恢复/u);
  assert.match(app, /load\(true\)/u);
  assert.match(api, /afterCreatedAt/u);
  assert.match(worker, /INVALID_MESSAGE_CURSOR/u);
  assert.match(media, /clientUploadId/u);
});

test('media reservations are idempotent and abandoned uploads are quarantined', async () => {
  const [migration, store, retention] = await Promise.all([
    read('../migrations/0019_media_upload_idempotency.sql'),
    read('../src/worker/media-store.ts'),
    read('../src/worker/conversation-retention.ts'),
  ]);

  assert.match(migration, /client_upload_id/u);
  assert.match(migration, /CREATE UNIQUE INDEX/u);
  assert.match(store, /INSERT OR IGNORE INTO media_items/u);
  assert.match(store, /MediaUploadIdConflictError/u);
  assert.match(retention, /status = 'failed'/u);
  assert.match(retention, /'-2 hours'/u);
});
