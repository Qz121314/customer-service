import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent quick replies are direct browser-local data only', async () => {
  const [main, localReplies, api, worker, entry, dropMigration] =
    await Promise.all([
      read('../src/dashboard/main.tsx'),
      read('../src/dashboard/agent-local-quick-replies.ts'),
      read('../src/dashboard/api.ts'),
      read('../src/worker/agent-api.ts'),
      read('../src/worker/entry.ts'),
      read('../migrations/0031_drop_quick_reply_compatibility_view.sql'),
    ]);

  assert.doesNotMatch(main, /import '\.\/agent-local-quick-replies';/u);
  assert.match(localReplies, /cs-agent-quick-replies:\$\{agentId\}/u);
  assert.match(localReplies, /listLocalQuickReplies/u);
  assert.match(localReplies, /createLocalQuickReply/u);
  assert.match(localReplies, /deleteLocalQuickReply/u);
  assert.match(localReplies, /crypto\.randomUUID\(\)/u);
  assert.doesNotMatch(localReplies, /window\.fetch\s*=/u);
  assert.doesNotMatch(localReplies, /\/api\/agent\/quick-replies/u);

  assert.match(api, /withLocalQuickReplies/u);
  assert.match(api, /createLocalQuickReply/u);
  assert.match(api, /deleteLocalQuickReply/u);
  assert.doesNotMatch(api, /request\(['"`]\/api\/agent\/quick-replies/u);

  assert.doesNotMatch(worker, /agent_quick_replies/u);
  assert.doesNotMatch(worker, /\/api\/agent\/quick-replies/u);
  assert.doesNotMatch(entry, /QUICK_REPLY/u);
  assert.doesNotMatch(entry, /agent_quick_replies/u);
  assert.match(dropMigration, /DROP VIEW IF EXISTS agent_quick_replies;/u);
});

test('local quick reply constraints stay bounded', async () => {
  const localReplies = await read(
    '../src/dashboard/agent-local-quick-replies.ts',
  );

  assert.match(localReplies, /QUICK_REPLY_LIMIT = 30/u);
  assert.match(localReplies, /QUICK_REPLY_TITLE_LIMIT = 40/u);
  assert.match(localReplies, /QUICK_REPLY_BODY_LIMIT = 1000/u);
  assert.match(localReplies, /window\.localStorage/u);
  assert.match(localReplies, /window\.sessionStorage/u);
});
