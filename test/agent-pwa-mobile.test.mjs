import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const [manifestText, indexHtml, main, mobile, thread, composer] =
  await Promise.all([
    readFile(new URL('../public/agent.webmanifest', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/agent-mobile-layout.css', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/dashboard/agent-mobile-thread.css', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/dashboard/agent-mobile-composer.css', import.meta.url),
      'utf8',
    ),
  ]);

const manifest = JSON.parse(manifestText);

test('agent workspace exposes an installable standalone manifest', () => {
  assert.equal(manifest.id, '/agent');
  assert.equal(manifest.start_url, '/agent');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
  assert.match(indexHtml, /rel="manifest" href="\/agent\.webmanifest"/u);
});

test('agent mobile workspace switches between inbox and a full-screen thread', () => {
  assert.match(main, /setupAgentMobileNavigation/u);
  assert.match(mobile, /height: 100dvh/u);
  assert.match(thread, /mobile-thread-open/u);
  assert.match(thread, /agent-mobile-back/u);
  assert.match(composer, /safe-area-inset-bottom/u);
  assert.match(composer, /font-size: 16px/u);
});
