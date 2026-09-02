import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainEntry = readFileSync('src/dashboard/main.tsx', 'utf8');

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

test('dashboard keeps admin and agent route entries isolated behind dynamic imports', () => {
  assert.match(mainEntry, /import\('\.\/agent-entry'\)/u);
  assert.match(mainEntry, /import\('\.\/admin-entry'\)/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/agent-entry['"]/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/admin-entry['"]/u);
});

test('optional dashboard surfaces keep their heavy implementations deferred', () => {
  for (const [wrapperPath, implementationPath] of deferredSurfaces) {
    const wrapper = readFileSync(wrapperPath, 'utf8');
    assert.ok(
      wrapper.includes(`import('${implementationPath}')`),
      `${wrapperPath} must dynamically import ${implementationPath}`,
    );
    assert.ok(
      !wrapper.includes(`from '${implementationPath}'`) &&
        !wrapper.includes(`from "${implementationPath}"`),
      `${wrapperPath} must not statically import ${implementationPath}`,
    );
  }
});
