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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('dashboard keeps admin and agent route entries isolated behind dynamic imports', () => {
  assert.match(mainEntry, /import\('\.\/agent-entry'\)/u);
  assert.match(mainEntry, /import\('\.\/admin-entry'\)/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/agent-entry['"]/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/admin-entry['"]/u);
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
