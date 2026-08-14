import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const [migration, mediaApi, mediaStore, compression, agentMedia, app] =
  await Promise.all([
    readFile(new URL('../migrations/0008_media.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker/media-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker/media-store.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/image-compress.ts', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/dashboard/agent-media.ts', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/dashboard/App.tsx', import.meta.url), 'utf8'),
  ]);

test('image messages use a separate R2 media model', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS media_items/u);
  assert.match(migration, /kind TEXT NOT NULL DEFAULT 'text'/u);
  assert.match(mediaStore, /env\.MEDIA|bucket\.put/u);
});

test('visitor and agent both have authorized media routes', () => {
  assert.match(mediaApi, /\/client\/v1\/conversations\/:id\/media\/init/u);
  assert.match(mediaApi, /\/api\/agent\/conversations\/:id\/media\/init/u);
  assert.match(mediaApi, /\/client\/v1\/media\/:id\/content/u);
  assert.match(mediaApi, /\/api\/agent\/media\/:id\/content/u);
});

test('static chat images are compressed before upload', () => {
  assert.match(compression, /MAX_EDGE = 1600/u);
  assert.match(compression, /TARGET_BYTES = 400 \* 1024/u);
  assert.match(compression, /image\/webp/u);
  assert.match(compression, /MAX_STATIC_BYTES = 1024 \* 1024/u);
});

test('agent workspace sends and renders image messages', () => {
  assert.match(agentMedia, /sendAgentImage/u);
  assert.match(agentMedia, /\/media\/init/u);
  assert.match(agentMedia, /\/complete/u);
  assert.match(app, /media-picker/u);
  assert.match(app, /message-image/u);
});
