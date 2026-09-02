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
  assert.match(worker, /loadAgentInbox\(c\.env\.DB, agent/u);
  assert.doesNotMatch(worker, /quickReplies/u);
  assert.doesNotMatch(api, /quickReplies|listLocalQuickReplies/u);
  assert.match(
    worker,
    /messages: pageMessages,[\s\S]*media,[\s\S]*readState/u,
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

test('bootstrap and refresh share the agent inbox loader', async () => {
  const [bootstrap, worker, sharedInbox] = await Promise.all([
    read('../src/worker/agent-bootstrap-api.ts'),
    read('../src/worker/agent-api.ts'),
    read('../src/worker/agent-inbox.ts'),
  ]);

  assert.ok(bootstrap.includes("from './agent-inbox'"));
  assert.ok(worker.includes("from './agent-inbox'"));
  assert.ok(bootstrap.includes('inbox: await loadAgentInbox'));
  assert.doesNotMatch(bootstrap, /loadBootstrapInbox|loadAgentQuotaOverview/u);
  assert.doesNotMatch(worker, /async function loadAgentInbox/u);

  for (const field of [
    '__overview_open',
    '__overview_pending',
    '__overview_closed',
  ]) {
    assert.ok(sharedInbox.includes(field));
  }
  assert.ok(sharedInbox.includes('loadAgentQuotaOverview(db, agent.id)'));
  assert.ok(sharedInbox.includes('if (filtered)'));
  assert.ok(sharedInbox.includes('loadAgentOverview(db, agent.id)'));
  assert.equal(
    (sharedInbox.match(/loadAgentOverview\(db, agent\.id\)/gu) ?? []).length,
    1,
  );
  assert.ok(sharedInbox.includes('delete conversation.__overview_open'));
});