import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('Windows desktop shell is configured for the built agent workspace', async () => {
  const config = JSON.parse(
    await readFile(
      new URL('../src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(config.productName, '客服坐席工作台');
  assert.equal(config.build.frontendDist, '../dist');
  assert.deepEqual(config.bundle.targets, ['nsis']);
  assert.equal(config.bundle.windows.nsis.installMode, 'perUser');
});

test('agent settings expose a stable Windows installer and release update link', async () => {
  const source = await readFile(
    new URL(
      '../src/dashboard/AgentWindowsAppSettings.tsx',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(
    source,
    /releases\/latest\/download\/customer-service-agent-windows-x64\.exe/u,
  );
  assert.match(
    source,
    /github\.com\/Qz121314\/customer-service\/releases\/latest/u,
  );
  assert.match(source, /下载 Windows 应用/u);
  assert.match(source, /检查更新/u);
});

test('tagged CI builds and publishes the Windows installer', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /tags: \['v\*'\]/u);
  assert.match(workflow, /build-windows-release:/u);
  assert.match(workflow, /cargo tauri build/u);
  assert.match(workflow, /customer-service-agent-windows-x64\.exe/u);
});
