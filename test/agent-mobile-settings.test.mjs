import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const [panels, settings, styles, install] = await Promise.all([
  readFile(
    new URL('../src/dashboard/AgentWorkspacePanels.tsx', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/dashboard/AgentMobileSettings.tsx', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/dashboard/agent-mobile-settings.css', import.meta.url),
    'utf8',
  ),
  readFile(
    new URL('../src/dashboard/agent-pwa-install.ts', import.meta.url),
    'utf8',
  ),
]);

test('mobile agent header collapses secondary actions into one settings entry', () => {
  assert.match(panels, /<AgentMobileSettings/u);
  assert.match(settings, /aria-label="打开工作台设置"/u);
  assert.match(settings, /新消息通知/u);
  assert.match(settings, /消息提示音/u);
  assert.match(settings, /自动回复/u);
  assert.match(settings, /接待流量/u);
  assert.match(settings, /退出登录/u);
  assert.match(
    styles,
    /@media \(max-width: 760px\)[\s\S]*\.workspace-sidebar-actions\s*\{\s*display: none;/u,
  );
  assert.match(
    styles,
    /\.agent-mobile-settings\s*\{[\s\S]*display: block;/u,
  );
});

test('mobile settings exposes a dedicated PWA install path without Worker reads', () => {
  assert.match(settings, /安装客服工作台/u);
  assert.match(settings, /添加到主屏幕/u);
  assert.match(settings, /安装应用/u);
  assert.match(install, /beforeinstallprompt/u);
  assert.match(install, /appinstalled/u);
  assert.match(install, /display-mode: standalone/u);
  assert.match(install, /navigatorWithStandalone\.standalone/u);
  assert.doesNotMatch(install, /fetch\(/u);
});
