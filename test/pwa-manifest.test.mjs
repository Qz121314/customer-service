import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const manifest = JSON.parse(
  await readFile(
    new URL('../public/agent.webmanifest', import.meta.url),
    'utf8',
  ),
);

test('agent PWA opens directly into the standalone workspace', () => {
  assert.equal(manifest.id, '/agent');
  assert.equal(manifest.start_url, '/agent');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
});
