import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicEntry = readFileSync('src/worker/h5-public-entry.ts', 'utf8');
const visitorChat = readFileSync('src/dashboard/VisitorChatPage.tsx', 'utf8');
const mainEntry = readFileSync('src/dashboard/main.tsx', 'utf8');

test('H5 public runtime keeps uploaded HTML isolated and injects declarative CTA config', () => {
  assert.match(publicEntry, /data-h5-cta/u);
  assert.match(publicEntry, /chat_public_origin/u);
  assert.match(publicEntry, /allow-top-navigation-by-user-activation/u);
  assert.match(publicEntry, /connect-src 'none'/u);
  assert.doesNotMatch(publicEntry, /fetch\s*\(/u);
  assert.doesNotMatch(publicEntry, /script[^>]+src=/iu);
});

test('visitor chat is a real same-origin surface with stable identity and existing protocols', () => {
  assert.match(mainEntry, /pathname\.startsWith\('\/chat'\)/u);
  assert.match(visitorChat, /localStorage/u);
  assert.match(visitorChat, /sourceHandoffId/u);
  assert.match(visitorChat, /startVisitorConversation/u);
  assert.match(visitorChat, /sendVisitorMessage/u);
  assert.match(visitorChat, /openVisitorConversationSocket/u);
  assert.match(visitorChat, /markVisitorConversationRead/u);
});
