import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('migrations/0009_agent_unread.sql', root),
  'utf8',
);
const client = await readFile(
  new URL('src/worker/client-api.ts', root),
  'utf8',
);
const media = await readFile(
  new URL('src/worker/media-store.ts', root),
  'utf8',
);
const agent = await readFile(new URL('src/worker/agent-api.ts', root), 'utf8');
const api = await readFile(new URL('src/dashboard/api.ts', root), 'utf8');
const app = await readFile(new URL('src/dashboard/App.tsx', root), 'utf8');

test('visitor text and image messages persist agent unread counts', () => {
  assert.match(migration, /agent_unread_count INTEGER NOT NULL DEFAULT 0/u);
  assert.match(client, /agent_unread_count = agent_unread_count \+ 1/u);
  assert.match(media, /agent_unread_count = agent_unread_count \+ 1/u);
});

test('agent inbox exposes and clears persistent unread state', () => {
  assert.match(agent, /c\.agent_unread_count/u);
  assert.match(agent, /conversations\/:id\/read/u);
  assert.match(agent, /SET agent_unread_count = 0/u);
  assert.match(api, /markConversationRead/u);
});

test('workspace highlights unread conversations and updates the document title', () => {
  assert.match(app, /totalUnread/u);
  assert.match(app, /document\.title/u);
  assert.match(app, /unread-badge/u);
  assert.match(app, /conversation\.agent_unread_count > 0 \? 'unread'/u);
  assert.match(app, /acknowledgeConversation/u);
});
