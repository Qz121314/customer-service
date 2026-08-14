import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const migration = await readFile(
  new URL('migrations/0010_visitor_web_push.sql', root),
  'utf8',
);
const entry = await readFile(new URL('src/worker/entry.ts', root), 'utf8');
const api = await readFile(new URL('src/worker/push-api.ts', root), 'utf8');
const push = await readFile(
  new URL('src/worker/visitor-push.ts', root),
  'utf8',
);

test('visitor push subscriptions are isolated by site and visitor identity', () => {
  assert.match(migration, /visitor_push_subscriptions/u);
  assert.match(migration, /site_id TEXT NOT NULL/u);
  assert.match(migration, /visitor_external_id TEXT NOT NULL/u);
  assert.match(api, /CONVERSATION_NOT_FOUND/u);
  assert.match(api, /COALESCE\(c\.expires_at/u);
  assert.match(api, /ON CONFLICT\(endpoint\) DO UPDATE/u);
});

test('VAPID keys are persistent and push delivery has no payload dependency', () => {
  assert.match(migration, /visitor_push_vapid/u);
  assert.match(push, /crypto\.subtle\.generateKey/u);
  assert.match(
    push,
    /Authorization: `vapid t=\$\{token\}, k=\$\{config\.public_key\}`/u,
  );
  assert.match(push, /method: 'POST'/u);
  assert.doesNotMatch(push, /Content-Encoding/u);
  assert.match(push, /response\.status === 404 \|\| response\.status === 410/u);
});

test('successful agent text and image replies wake visitor subscriptions', () => {
  assert.match(entry, /AGENT_TEXT_MESSAGE_PATH/u);
  assert.match(entry, /AGENT_MEDIA_COMPLETE_PATH/u);
  assert.match(entry, /sendVisitorPushForConversation/u);
  assert.match(entry, /c\.executionCtx\.waitUntil/u);
  assert.match(entry, /app\.route\('\/', pushApi\)/u);
});
