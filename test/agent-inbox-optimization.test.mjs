import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent inbox returns overview, conversations, messages and media in two requests', async () => {
  const [api, worker, app] = await Promise.all([
    read('../src/dashboard/api.ts'),
    read('../src/worker/agent-api.ts'),
    read('../src/dashboard/AgentPortal.tsx'),
  ]);

  assert.match(api, /getAgentInbox/u);
  assert.match(api, /request\('\/api\/agent\/conversations'\)/u);
  assert.match(
    worker,
    /conversations: result\.results \?\? \[\],[\s\S]*overview/u,
  );
  assert.match(worker, /transferTargets,[\s\S]*quickReplies/u);
  assert.match(
    worker,
    /messages: messages\.results \?\? \[\],[\s\S]*media,[\s\S]*readState/u,
  );
  assert.doesNotMatch(app, /getConversations\(filter/u);
  assert.doesNotMatch(app, /getAgentMedia\(selectedId\)/u);
});

test('agent inbox filters, searches and prioritizes unread conversations locally', async () => {
  const [portal, panels] = await Promise.all([
    read('../src/dashboard/AgentPortal.tsx'),
    read('../src/dashboard/AgentWorkspacePanels.tsx'),
  ]);
  const app = `${portal}\n${panels}`;

  assert.match(app, /visibleConversations = useMemo/u);
  assert.match(app, /搜索访客、产品或消息/u);
  assert.match(app, /未读优先/u);
  assert.match(app, /conversation\.agent_unread_count/u);
});
