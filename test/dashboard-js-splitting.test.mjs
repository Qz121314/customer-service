import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainEntry = readFileSync('src/dashboard/main.tsx', 'utf8');
const tauriMain = readFileSync('src-tauri/src/main.rs', 'utf8');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(
  readFileSync('src-tauri/tauri.conf.json', 'utf8'),
);
const cargoManifest = readFileSync('src-tauri/Cargo.toml', 'utf8');

const deferredSurfaces = [
  ['src/dashboard/AdminStatisticsPage.tsx', './AdminStatisticsPageImpl'],
  ['src/dashboard/AgentEditorModal.tsx', './AgentEditorModalImpl'],
  [
    'src/dashboard/AdminAgentStatisticsModal.tsx',
    './AdminAgentStatisticsModalImpl',
  ],
  ['src/dashboard/NoAgentMessageSettings.tsx', './NoAgentMessageSettingsImpl'],
  [
    'src/dashboard/AgentStatisticsWorkspace.tsx',
    './AgentStatisticsWorkspaceImpl',
  ],
  ['src/dashboard/AgentAttachmentTools.tsx', './AgentAttachmentToolsImpl'],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('dashboard keeps admin and agent route entries isolated behind dynamic imports', () => {
  assert.match(mainEntry, /import\('\.\/agent-entry'\)/u);
  assert.match(mainEntry, /import\('\.\/admin-entry'\)/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/agent-entry['"]/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/admin-entry['"]/u);
});

test('Tauri desktop always opens the agent login route', () => {
  assert.match(mainEntry, /isTauri\(\)/u);
  assert.match(mainEntry, /window\.location\.protocol === ['"]tauri:['"]/u);
  assert.match(
    mainEntry,
    /window\.location\.hostname === ['"]tauri\.localhost['"]/u,
  );
  assert.match(
    mainEntry,
    /window\.history\.replaceState\(null, '', '\/agent'\)/u,
  );
});

test('release Tauri builds hide the Windows console window', () => {
  assert.match(
    tauriMain,
    /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/u,
  );
});

test('Tauri desktop loads the agent page from the production Worker', () => {
  const agentUrl = 'https://customer-service-app.fcqz121314.workers.dev/agent';
  assert.equal(tauriConfig.app.windows[0].url, agentUrl);
  assert.equal(tauriConfig.build.frontendDist, agentUrl);
});

test('desktop package versions stay aligned across manifests', () => {
  assert.equal(packageJson.version, tauriConfig.version);
  assert.match(
    cargoManifest,
    new RegExp(`^version = "${escapeRegExp(tauriConfig.version)}"$`, 'mu'),
  );
});

test('optional dashboard surfaces keep runtime implementations deferred', () => {
  for (const [wrapperPath, implementationPath] of deferredSurfaces) {
    const wrapper = readFileSync(wrapperPath, 'utf8');
    const escapedImplementationPath = escapeRegExp(implementationPath);

    assert.match(
      wrapper,
      new RegExp(
        `lazy\\(\\(\\)\\s*=>\\s*import\\(['"]${escapedImplementationPath}['"]\\)`,
        'u',
      ),
      `${wrapperPath} must lazily import ${implementationPath}`,
    );
    assert.match(
      wrapper,
      new RegExp(
        `import\\s+type\\s+[^;]+?from\\s+['"]${escapedImplementationPath}['"]`,
        'u',
      ),
      `${wrapperPath} must import its Props contract as type-only`,
    );
    assert.doesNotMatch(
      wrapper,
      new RegExp(
        `import\\s+(?!type\\b)[^;]+?from\\s+['"]${escapedImplementationPath}['"]`,
        'u',
      ),
      `${wrapperPath} must not statically import ${implementationPath} at runtime`,
    );
    assert.doesNotMatch(
      wrapper,
      /\b(?:Parameters|ComponentProps)\s*</u,
      `${wrapperPath} must use an explicit Props contract`,
    );
  }
});
