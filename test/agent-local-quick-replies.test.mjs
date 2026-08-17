import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent quick replies are browser-local only with no D1 migration path', async () => {
  const [main, localReplies, entry, dropMigration] = await Promise.all([
    read('../src/dashboard/main.tsx'),
    read('../src/dashboard/agent-local-quick-replies.ts'),
    read('../src/worker/entry.ts'),
    read('../migrations/0029_remove_agent_quick_replies.sql'),
  ]);

  assert.match(main, /import '\.\/agent-local-quick-replies';/u);
  assert.match(localReplies, /cs-agent-quick-replies:\$\{agentId\}/u);
  assert.doesNotMatch(localReplies, /quick-replies-migrated/u);
  assert.doesNotMatch(localReplies, /X-CS-Quick-Replies-Local/u);
  assert.doesNotMatch(localReplies, /hasCompletedMigration/u);
  assert.match(
    localReplies,
    /payload\.quickReplies = loadQuickReplies\(agentId\)/u,
  );
  assert.match(localReplies, /crypto\.randomUUID\(\)/u);

  assert.match(entry, /QUICK_REPLY_FREE_INBOX_PATHS/u);
  assert.match(entry, /LEGACY_QUICK_REPLY_SELECT/u);
  assert.match(entry, /emptyQuickReplyStatement\(\)/u);
  assert.match(entry, /LOCAL_QUICK_REPLIES_ONLY/u);
  assert.doesNotMatch(entry, /X-CS-Quick-Replies-Local/u);
  assert.match(dropMigration, /DROP TABLE IF EXISTS agent_quick_replies;/u);
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
  assert.doesNotMatch(localReplies, /nativeFetch\(.*quick-replies/u);
});
