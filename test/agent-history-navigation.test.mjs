import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const history = readFileSync('src/dashboard/agent-history.ts', 'utf8');
const main = readFileSync('src/dashboard/main.tsx', 'utf8');
const agentEntry = readFileSync('src/dashboard/agent-entry.tsx', 'utf8');
const panels = readFileSync('src/dashboard/AgentWorkspacePanels.tsx', 'utf8');

test('agent conversations participate in browser history for native back gestures', () => {
  assert.ok(
    history.includes("const AGENT_HISTORY_KEY = '__customerServiceAgentView';"),
  );
  assert.ok(
    history.includes(
      "window.history.pushState(nextState, '', window.location.href);",
    ),
  );
  assert.ok(panels.includes('rememberAgentConversationHistory('));
  assert.ok(panels.includes('data-conversation-id={conversation.id}'));
  assert.ok(main.includes("import('./agent-entry')"));
  assert.ok(agentEntry.includes("window.addEventListener('popstate'"));
  assert.ok(
    agentEntry.includes("document.body.style.overscrollBehaviorX = 'auto';"),
  );
  assert.ok(agentEntry.includes("'.conversation-row[data-conversation-id]'"));
  assert.ok(agentEntry.includes("'.thread-back-button'"));
  assert.ok(agentEntry.includes('window.history.back();'));
});
