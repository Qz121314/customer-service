import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent quick replies migrate once to local storage and leave the D1 hot path', async () => {
  const [main, localReplies, entry] = await Promise.all([
    read('../src/dashboard/main.tsx'),
    read('../src/dashboard/agent-local-quick-replies.ts'),
    read('../src/worker/entry.ts'),
  ]);

  assert.match(main, /import '\.\/agent-local-quick-replies';/u);
  assert.match(localReplies, /cs-agent-quick-replies:\$\{agentId\}/u);
  assert.match(localReplies, /cs-agent-quick-replies-migrated:\$\{agentId\}/u);
  assert.match(localReplies, /X-CS-Quick-Replies-Local/u);
  assert.match(localReplies, /hasCompletedMigration\(activeAgentId as string\)/u);
  assert.match(localReplies, /payload\.quickReplies = loadQuickReplies\(agentId\)/u);
  assert.match(localReplies, /crypto\.randomUUID\(\)/u);
  assert.match(entry, /LEGACY_QUICK_REPLY_SELECT/u);
  assert.match(entry, /emptyQuickReplyStatement\(\)/u);
  assert.match(entry, /LOCAL_QUICK_REPLIES_ONLY/u);
});

test('quick reply create and delete calls are handled in the browser', async () => {
  const localReplies = await read(
    '../src/dashboard/agent-local-quick-replies.ts',
  );

  assert.match(
    localReplies,
    /pathname === QUICK_REPLY_PATH && method === 'POST'/u,
  );
  assert.match(
    localReplies,
    /pathname\.startsWith\(`\$\{QUICK_REPLY_PATH\}\/`\) && method === 'DELETE'/u,
  );
  assert.match(localReplies, /QUICK_REPLY_LIMIT = 30/u);
  assert.match(localReplies, /QUICK_REPLY_TITLE_LIMIT = 40/u);
  assert.match(localReplies, /QUICK_REPLY_BODY_LIMIT = 1000/u);
});
