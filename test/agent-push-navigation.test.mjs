import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function surfaceSource(paths) {
  return paths.map(source).join('\n');
}

test('agent push opens the latest unread thread without reloading the workspace', () => {
  const serviceWorker = source('../public/agent-sw.js');
  const pushClient = source('../src/dashboard/agent-push.ts');
  const inbox = source('../src/dashboard/AgentWorkspacePanels.tsx');
  const statistics = surfaceSource([
    '../src/dashboard/AgentStatisticsWorkspace.tsx',
    '../src/dashboard/AgentStatisticsWorkspaceImpl.tsx',
    '../src/dashboard/AgentStatisticsWorkspaceRuntime.tsx',
  ]);

  for (const contract of [
    "const AGENT_NOTIFICATION_URL = '/agent?notification=latest-unread';",
    "type: 'agent.notification.open'",
    "target: 'latest-unread'",
    'existingAgent.postMessage({',
    'await existingAgent.focus();',
  ]) {
    assert.ok(serviceWorker.includes(contract), contract);
  }

  assert.ok(!serviceWorker.includes('existingAgent.navigate('));

  for (const contract of [
    'hasAgentNotificationOpenIntent',
    'clearAgentNotificationOpenIntent',
    'isAgentNotificationOpenMessage',
  ]) {
    assert.ok(pushClient.includes(contract), contract);
  }

  for (const contract of [
    'notificationOverviewBaselineRef',
    'conversation.agent_unread_count > 0',
    'rightTime - leftTime',
    "onFilterChange('all')",
    "onSearchChange('')",
    'clearAgentNotificationOpenIntent();',
    "selectConversation(target.id, 'notification')",
  ]) {
    assert.ok(inbox.includes(contract), contract);
  }

  assert.ok(!inbox.includes('heartbeat('));
  assert.ok(!inbox.includes('getAgentInbox('));
  assert.ok(statistics.includes('isAgentNotificationOpenMessage(event.data)'));
});
