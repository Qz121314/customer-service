import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('default agent inbox never hides active conversations behind a global row limit', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadAgentInbox');
  const end = worker.indexOf("agentApi.get('/api/agent/stats'", start);
  assert.ok(start >= 0 && end > start);
  const inbox = worker.slice(start, end);

  assert.match(inbox, /WITH ranked AS/u);
  assert.match(
    inbox,
    /WHERE status <> 'closed' OR __closed_rank <= \?2/u,
  );
  assert.doesNotMatch(inbox, /LIMIT 100/u);
  assert.match(inbox, /CLOSED_INBOX_PREVIEW_LIMIT/u);
  assert.match(inbox, /closedHasMore: counts\.closed > closedLoaded/u);
});

test('only closed conversations are bounded in explicit filtered inbox reads', async () => {
  const worker = await read('../src/worker/agent-api.ts');
  const start = worker.indexOf('async function loadAgentInbox');
  const end = worker.indexOf("agentApi.get('/api/agent/stats'", start);
  const inbox = worker.slice(start, end);

  assert.match(inbox, /const shouldBoundClosed = requestedStatus === 'closed'/u);
  assert.match(inbox, /LIMIT COALESCE\(\?3, -1\)/u);
  assert.match(
    inbox,
    /shouldBoundClosed \? CLOSED_INBOX_PREVIEW_LIMIT : null/u,
  );
});

test('initial load, heartbeat and availability changes share one inbox loader', async () => {
  const worker = await read('../src/worker/agent-api.ts');

  assert.match(worker, /agentApi\.get\('\/api\/agent\/conversations'/u);
  assert.match(worker, /agentApi\.post\('\/api\/agent\/auth\/heartbeat'/u);
  assert.match(worker, /agentApi\.post\('\/api\/agent\/auth\/status'/u);
  assert.equal((worker.match(/loadAgentInbox\(c\.env\.DB/gu) ?? []).length, 3);
});
