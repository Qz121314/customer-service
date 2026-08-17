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
  assert.match(api, /request<AgentInbox>\('\/api\/agent\/conversations'\)/u);
  assert.match(
    worker,
    /conversations: result\.results \?\? \[\],[\s\S]*overview/u,
  );
  assert.match(worker, /transferTargets,[\s\S]*availability/u);
  assert.doesNotMatch(worker, /quickReplies/u);
  assert.doesNotMatch(api, /quickReplies|listLocalQuickReplies/u);
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

test('agent inbox folds unfiltered overview counts into the conversation scan', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadAgentInbox');
  const end = worker.indexOf("agentApi.get('/api/agent/stats'", start);
  assert.ok(start >= 0 && end > start);
  const inbox = worker.slice(start, end);

  assert.match(
    inbox,
    /SUM\(CASE WHEN c\.status = 'open' THEN 1 ELSE 0 END\) OVER \(\) AS __overview_open/u,
  );
  assert.match(
    inbox,
    /SUM\(CASE WHEN c\.status = 'pending' THEN 1 ELSE 0 END\) OVER \(\) AS __overview_pending/u,
  );
  assert.match(
    inbox,
    /SUM\(CASE WHEN c\.status = 'closed' THEN 1 ELSE 0 END\) OVER \(\) AS __overview_closed/u,
  );
  assert.match(inbox, /loadAgentQuotaOverview\(db, agent\.id\)/u);
  assert.match(
    inbox,
    /if \(filtered\) \{[\s\S]*loadAgentOverview\(db, agent\.id\)/u,
  );
  assert.equal(
    (inbox.match(/loadAgentOverview\(db, agent\.id\)/gu) ?? []).length,
    1,
  );
  assert.match(inbox, /delete conversation\.__overview_open/u);
});
