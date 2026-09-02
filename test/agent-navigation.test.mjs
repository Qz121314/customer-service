import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent workspace owns browser navigation with one serializable route state', () => {
  const navigation = source('../src/dashboard/agent-navigation.ts');
  const portal = source('../src/dashboard/AgentPortal.tsx');
  const panels = source('../src/dashboard/AgentWorkspacePanels.tsx');
  const entry = source('../src/dashboard/agent-entry.tsx');

  for (const contract of [
    "const AGENT_NAVIGATION_KEY = '__customerServiceAgentNavigation';",
    "{ kind: 'inbox' } | { kind: 'thread'; conversationId: string }",
    "'none' | 'menu' | 'cards' | 'autoReply' | 'statistics'",
    "window.addEventListener('popstate', restoreFromHistory)",
    "window.history.pushState(nextState, '', window.location.href)",
    "window.history.replaceState(nextState, '', window.location.href)",
  ]) {
    assert.ok(navigation.includes(contract), contract);
  }

  assert.ok(portal.includes('useAgentNavigation()'));
  assert.ok(portal.includes('replace(inboxRoute());'));
  assert.ok(portal.includes('navigate(threadRoute(conversationId));'));
  assert.ok(portal.includes("navigate(withOverlay(navigation, 'menu'))"));
  assert.ok(!panels.includes('useState<AgentMobileView>'));
  assert.ok(!entry.includes('reopenHistoryThread'));
  assert.ok(!entry.includes('threadStateObserver'));
  assert.equal(
    existsSync(new URL('../src/dashboard/agent-history.ts', import.meta.url)),
    false,
  );
});
