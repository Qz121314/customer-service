import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent inbox owns overview, conversations, messages and media without superseded reads', async () => {
  const [api, worker, app, mediaClient, mediaApi, desktopCss] =
    await Promise.all([
      read('../src/dashboard/api.ts'),
      read('../src/worker/agent-api.ts'),
      read('../src/dashboard/AgentPortal.tsx'),
      read('../src/dashboard/agent-media.ts'),
      read('../src/worker/media-api.ts'),
      read('../src/dashboard/agent-desktop-layout.css'),
    ]);

  assert.match(api, /getAgentInbox/u);
  assert.match(api, /request<AgentInbox>\('\/api\/agent\/conversations'\)/u);
  assert.match(worker, /const conversations = result\.results \?\? \[\]/u);
  assert.match(worker, /return \{[\s\S]*conversations,[\s\S]*overview:/u);
  assert.doesNotMatch(worker, /quickReplies/u);
  assert.doesNotMatch(api, /quickReplies|listLocalQuickReplies/u);
  assert.match(
    worker,
    /messages: messages\.results \?\? \[\],[\s\S]*media,[\s\S]*readState/u,
  );
  assert.doesNotMatch(app, /getConversations\(filter/u);
  assert.doesNotMatch(app, /getAgentMedia\(selectedId\)/u);
  assert.doesNotMatch(
    api,
    /export async function getOverview|getConversations/u,
  );
  assert.doesNotMatch(mediaClient, /export async function getAgentMedia/u);
  assert.doesNotMatch(worker, /\/api\/agent\/overview/u);
  assert.doesNotMatch(
    mediaApi,
    /mediaApi\.get\('\/api\/agent\/conversations\/:id\/media'/u,
  );
  assert.doesNotMatch(desktopCss, /quick-replies-trigger/u);
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
  assert.doesNotMatch(inbox, /requestedStatus|loadAgentOverview/u);
  assert.match(inbox, /delete conversation\.__overview_open/u);
});
