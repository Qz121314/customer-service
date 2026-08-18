import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('default agent inbox never hides active conversations behind a global row limit', async () => {
  const inbox = await read('../src/worker/agent-inbox-api.ts');
  const start = inbox.indexOf('async function loadAgentInbox');
  const end = inbox.indexOf('async function loadFilteredAgentInbox', start);
  assert.ok(start >= 0 && end > start);
  const defaultLoader = inbox.slice(start, end);

  assert.match(defaultLoader, /WITH ranked AS/u);
  assert.match(
    defaultLoader,
    /WHERE status <> 'closed' OR __closed_rank <= \?2/u,
  );
  assert.doesNotMatch(defaultLoader, /LIMIT 100/u);
  assert.doesNotMatch(defaultLoader, /LIMIT \?2/u);
  assert.match(defaultLoader, /CLOSED_PREVIEW_LIMIT/u);
  assert.match(defaultLoader, /closedHasMore/u);
  assert.match(defaultLoader, /nextClosedCursor/u);
});

test('closed history has a stable descending cursor and bounded on-demand page', async () => {
  const inbox = await read('../src/worker/agent-inbox-api.ts');

  assert.match(inbox, /const CLOSED_HISTORY_PAGE_LIMIT = 50/u);
  assert.match(inbox, /c\.last_message_at < \?3/u);
  assert.match(inbox, /c\.last_message_at = \?3 AND c\.id < \?4/u);
  assert.match(inbox, /CLOSED_HISTORY_PAGE_LIMIT \+ 1/u);
  assert.match(inbox, /rows\.slice\(0, CLOSED_HISTORY_PAGE_LIMIT\)/u);
});

test('initial load, heartbeat and availability changes share the bounded inbox owner', async () => {
  const [entry, inbox] = await Promise.all([
    read('../src/worker/entry.ts'),
    read('../src/worker/agent-inbox-api.ts'),
  ]);

  assert.ok(
    entry.indexOf("app.route('/', agentInboxApi);") <
      entry.indexOf("app.route('/', agentApi);"),
    'agentInboxApi must own overlapping inbox routes before agentApi',
  );
  assert.match(inbox, /agentInboxApi\.get\('\/api\/agent\/conversations'/u);
  assert.match(inbox, /agentInboxApi\.post\('\/api\/agent\/auth\/heartbeat'/u);
  assert.match(inbox, /agentInboxApi\.post\('\/api\/agent\/auth\/status'/u);
  assert.equal((inbox.match(/loadAgentInbox\(c\.env\.DB/gu) ?? []).length, 3);
});
