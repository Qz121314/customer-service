import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainEntry = readFileSync('src/dashboard/main.tsx', 'utf8');
const adminPortal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const agentPortal = readFileSync('src/dashboard/AgentPortal.tsx', 'utf8');

test('dashboard keeps admin and agent route entries isolated behind dynamic imports', () => {
  assert.match(mainEntry, /import\('\.\/agent-entry'\)/u);
  assert.match(mainEntry, /import\('\.\/admin-entry'\)/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/agent-entry['"]/u);
  assert.doesNotMatch(mainEntry, /from ['"]\.\/admin-entry['"]/u);
});

test('admin optional surfaces stay out of the initial admin module graph', () => {
  for (const modulePath of [
    './AdminStatisticsPage',
    './AgentEditorModal',
    './AdminAgentStatisticsModal',
    './NoAgentMessageSettings',
  ]) {
    assert.doesNotMatch(
      adminPortal,
      new RegExp(`from ['"]${modulePath.replaceAll('.', '\\.') }['"]`, 'u'),
      modulePath,
    );
    assert.ok(adminPortal.includes(`import('${modulePath}')`), modulePath);
  }
});

test('agent optional tools stay out of the initial agent module graph', () => {
  for (const modulePath of [
    './AgentStatisticsWorkspace',
    './AgentAttachmentTools',
    './agent-attachments-client',
    './agent-media',
  ]) {
    assert.doesNotMatch(
      agentPortal,
      new RegExp(`from ['"]${modulePath.replaceAll('.', '\\.') }['"]`, 'u'),
      modulePath,
    );
    assert.ok(agentPortal.includes(`import('${modulePath}')`), modulePath);
  }
});
