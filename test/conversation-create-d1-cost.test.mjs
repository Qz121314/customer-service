import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clientSource = readFileSync('src/worker/client-api.ts', 'utf8');
const routingSource = readFileSync('src/worker/routing.ts', 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('new conversation replay checks share one D1 statement', () => {
  const route = section(
    clientSource,
    "clientApi.post('/client/v1/conversations'",
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );

  assert.match(route, /WITH message_match AS/u);
  assert.match(route, /handoff_match AS/u);
  assert.match(route, /message_conversation_id/u);
  assert.match(route, /handoff_conversation_id/u);
  assert.doesNotMatch(
    route,
    /const existingHandoff = await c\.env\.DB\.prepare/u,
  );
});

test('visitor upsert keeps returning visitors to one D1 statement', () => {
  const helper = section(
    clientSource,
    'async function ensureVisitor(',
    'async function resolveIdentity(',
  );

  assert.match(helper, /ON CONFLICT\(site_id, external_id\) DO UPDATE SET/u);
  assert.match(helper, /RETURNING id, site_id, external_id, expires_at/u);
  assert.doesNotMatch(helper, /SELECT id, site_id, external_id/u);
  assert.equal((helper.match(/\.prepare\(/gu) ?? []).length, 1);
});

test('stable product routing context avoids unnecessary writes', () => {
  const helper = section(
    clientSource,
    'async function rememberProductRoutingContext(',
    'async function ensureVisitor(',
  );

  assert.match(helper, /WHERE title IS NOT excluded\.title/u);
  assert.match(helper, /category_name IS NOT excluded\.category_name/u);
  assert.match(helper, /OR is_enabled <> 1/u);
});

test('new conversation response reuses the broadcaster conversation read', () => {
  const route = section(
    clientSource,
    'const assignment = await assignConversationAgent',
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );
  const broadcaster = section(
    clientSource,
    'export async function broadcastClientConversationEvent(',
    'async function loadAgentOverview(',
  );

  assert.match(
    route,
    /const conversation = await broadcastClientConversationEvent/u,
  );
  assert.doesNotMatch(route, /await ownedConversation\(/u);
  assert.match(broadcaster, /Promise<ConversationRow \| null>/u);
  assert.match(broadcaster, /return conversation;/u);
});

test('normal routing assignment keeps only the assignment and agent-touch statements', () => {
  const route = section(
    routingSource,
    'export async function assignConversationAgent(',
    'async function assignedAgent(',
  );

  assert.match(route, /WITH context AS/u);
  assert.match(route, /JOIN matching m ON m\.agent_id = c\.assigned_agent/u);
  assert.match(route, /RETURNING assigned_agent AS id/u);
  assert.doesNotMatch(route, /const conversation = await db/u);
  assert.equal((route.match(/\.prepare\(/gu) ?? []).length, 2);
});
