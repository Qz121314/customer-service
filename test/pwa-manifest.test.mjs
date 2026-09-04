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
  assert.equal(manifest.scope, '/agent');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.display_override, ['standalone', 'minimal-ui']);
  assert.deepEqual(
    manifest.icons.map((icon) => icon.sizes),
    ['192x192', '512x512'],
  );
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ['/icons/customer-service-192.svg', '/icons/customer-service-512.svg'],
  );
});

test('agent shell exposes mobile standalone metadata and registers an agent-only service worker', async () => {
  const [index, main, agentEntry, install, chrome, mobileCss] =
    await Promise.all([
      readFile(new URL('../index.html', import.meta.url), 'utf8'),
      readFile(new URL('../src/dashboard/main.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/dashboard/agent-entry.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/dashboard/agent-install.ts', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/dashboard/AgentWorkspaceChrome.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/dashboard/agent-mobile-layout.css', import.meta.url),
        'utf8',
      ),
    ]);

  assert.match(index, /apple-mobile-web-app-capable/u);
  assert.match(index, /apple-mobile-web-app-title/u);
  assert.match(index, /viewport-fit=cover/u);
  assert.ok(main.includes("import('./agent-entry')"));
  assert.ok(
    agentEntry.includes(".register('/agent-sw.js', { scope: '/agent' })"),
  );
  assert.match(install, /addEventListener\('beforeinstallprompt'/u);
  assert.match(install, /deferredInstallPrompt/u);
  assert.match(install, /await prompt\.prompt\(\)/u);
  assert.match(install, /addEventListener\('appinstalled'/u);
  assert.match(chrome, /aria-label="打开功能菜单"/u);
  assert.match(chrome, /aria-label="安装到手机"/u);
  assert.match(chrome, />名片</u);
  assert.match(chrome, />首次问候语</u);
  assert.match(mobileCss, /\.workspace-sidebar-actions \{\s*display: none;/u);
  assert.match(mobileCss, /\.mobile-agent-settings-page/u);
});

test('agent service worker keeps every push user-visible and alerts in the background', async () => {
  const source = await readFile(
    new URL('../public/agent-sw.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /addEventListener\('install'/u);
  assert.match(source, /addEventListener\('fetch'/u);
  assert.match(source, /agent-workspace-v5/u);
  assert.match(source, /const AGENT_SHELL_URL = '\/index\.html';/u);
  assert.match(source, /const APP_SHELL = \[\s*AGENT_SHELL_URL,/u);
  assert.doesNotMatch(source, /const APP_SHELL = \[\s*AGENT_WORKSPACE_URL,/u);
  assert.match(source, /cache\.put\(AGENT_SHELL_URL, response\.clone\(\)\)/u);
  assert.match(source, /caches\.match\(AGENT_SHELL_URL\)/u);
  assert.match(source, /!url\.pathname\.startsWith\('\/agent'\)/u);
  assert.match(source, /addEventListener\('push'/u);
  assert.match(source, /const foreground = clients\.some/u);
  assert.match(source, /return self\.registration\.showNotification/u);
  assert.match(source, /silent: foreground/u);
  assert.match(source, /agent-message-\$\{payload\.messageId\}/u);
  assert.match(source, /payload\.type !== 'NEW_CONVERSATION'/u);
  assert.match(source, /conversationId: payload\.conversationId/u);
  assert.match(source, /setAppBadge/u);
  assert.doesNotMatch(
    source,
    /if \(clients\.some\([\s\S]{0,140}visibilityState === 'visible'[\s\S]{0,80}\)\) \{\s*return undefined;/u,
  );
  assert.match(source, /addEventListener\('notificationclick'/u);
  assert.match(source, /'\/agent'/u);
});
