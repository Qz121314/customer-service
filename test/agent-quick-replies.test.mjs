import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent quick replies are persisted per seat and exposed only for the assigned seat', async () => {
  const [migration, settingsApi, clientApi, visitorPage] = await Promise.all([
    read('../migrations/0067_agent_quick_replies.sql'),
    read('../src/worker/agent-auto-reply-api.ts'),
    read('../src/worker/client-api.ts'),
    read('../src/dashboard/VisitorChatPage.tsx'),
  ]);

  assert.match(migration, /agent_quick_replies/u);
  assert.match(migration, /agent_id TEXT NOT NULL/u);
  assert.match(settingsApi, /requireAgentSession/u);
  assert.match(settingsApi, /agentAutoReplyApi\.put\([\s\S]*quick-replies/u);
  assert.match(clientApi, /agent_id = \?2 AND enabled = 1/u);
  assert.match(clientApi, /auto_reply/u);
  assert.match(clientApi, /quick-reply-answer:/u);
  assert.match(visitorPage, /sendVisitorQuickReply/u);
  assert.match(visitorPage, /常见问题/u);
});
