import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const agentSource = readFileSync('src/worker/agent-api.ts', 'utf8');
const assignmentBroadcastSource = readFileSync(
  'src/worker/assignment-broadcast.ts',
  'utf8',
);
const clientSource = readFileSync('src/worker/client-api.ts', 'utf8');
const mediaSource = readFileSync('src/worker/media-store.ts', 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing start marker: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing end marker: ${end}`);
  return source.slice(from, to);
}

test('agent text sends keep persistence on a bounded D1 path and reuse the updated conversation snapshot', () => {
  const route = section(
    agentSource,
    "agentApi.post('/api/agent/conversations/:id/messages'",
    "agentApi.post('/api/agent/conversations/:id/status'",
  );
  const helper = section(
    agentSource,
    'async function assignedConversationForMessageWrite(',
    'async function assignedConversation(',
  );
  const broadcaster = section(
    clientSource,
    'export async function broadcastClientConversationEvent(',
    'function agentConversationSummary(',
  );

  assert.match(route, /assignedConversationForMessageWrite\(/u);
  assert.doesNotMatch(route, /assignedConversation\(c\.env\.DB/u);
  assert.match(route, /client_message_id, created_at/u);
  assert.match(route, /const message: MessageRow = \{/u);
  assert.doesNotMatch(route, /FROM messages WHERE id = \?1/u);
  assert.match(route, /UPDATE conversations[\s\S]*RETURNING/u);
  assert.match(route, /conversationSnapshot/u);
  assert.match(route, /await deferAgentRealtime\(/u);
  assert.doesNotMatch(route, /await Promise\.allSettled\(/u);

  assert.match(helper, /SELECT c\.id, c\.status/u);
  assert.match(helper, /v\.external_id/u);
  assert.match(helper, /v\.display_name AS visitor_name/u);
  assert.match(helper, /a\.name AS agent_name/u);
  assert.match(helper, /a\.avatar_version AS agent_avatar_version/u);
  assert.doesNotMatch(helper, /SELECT c\.\*/u);
  assert.doesNotMatch(helper, /c\.product_title/u);
  assert.doesNotMatch(helper, /c\.last_message_preview/u);

  assert.match(
    broadcaster,
    /conversationSnapshot\?: ConversationEventSnapshot/u,
  );
  assert.match(broadcaster, /options\.conversationSnapshot\s*\?\?/u);
});

test('visitor text sends keep duplicate reads off the normal write path', () => {
  const route = section(
    clientSource,
    "clientApi.post('/client/v1/conversations/:id/messages'",
    "clientApi.post('/client/v1/conversations/:id/read'",
  );
  const helper = section(
    clientSource,
    'async function persistClientMessage(',
    'function clientMessage(',
  );
  const ownership = section(
    clientSource,
    'async function ownedConversationForMessageWrite(',
    'async function ownedConversation(',
  );

  assert.match(route, /ownedConversationForMessageWrite\(/u);
  assert.doesNotMatch(route, /const existingMessage =/u);
  assert.match(route, /persistedMessage\.duplicate/u);
  assert.match(helper, /INSERT OR IGNORE INTO messages/u);
  assert.match(
    helper,
    /last_message_at = \?1, last_message_preview = \?2, updated_at = \?1/u,
  );
  assert.match(helper, /AND EXISTS \(SELECT 1 FROM messages WHERE id = \?4\)/u);
  assert.match(
    helper,
    /\.bind\(createdAt, input\.body, input\.conversationId, id\)/u,
  );
  assert.match(helper, /if \(!inserted\?\.meta\.changes\)/u);
  assert.match(helper, /const message: MessageRow = \{/u);
  assert.ok(
    helper.indexOf('if (!inserted?.meta.changes)') <
      helper.indexOf('WHERE conversation_id = ?1 AND client_message_id = ?2'),
    'duplicate SELECT must only run after an ignored insert',
  );
  assert.match(
    ownership,
    /SELECT c\.id, c\.visitor_id, c\.status, c\.assigned_agent/u,
  );
  assert.match(ownership, /AND c\.assigned_agent IS NOT NULL/u);
  assert.doesNotMatch(ownership, /last_message/u);
  assert.doesNotMatch(ownership, /LEFT JOIN agents/u);
  assert.doesNotMatch(
    route,
    /UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP/u,
  );
});

test('realtime overview scans run only when assignment or status counts can change', () => {
  const broadcaster = section(
    clientSource,
    'export async function broadcastClientConversationEvent(',
    'function agentConversationSummary(',
  );
  const assignmentBroadcaster = section(
    assignmentBroadcastSource,
    'export async function broadcastAssignments(',
    'async function broadcastAssignment(',
  );
  const clientRoute = section(
    clientSource,
    "clientApi.post('/client/v1/conversations/:id/messages'",
    "clientApi.post('/client/v1/conversations/:id/read'",
  );
  const visitorReadRoute = section(
    clientSource,
    "clientApi.post('/client/v1/conversations/:id/read'",
    "clientApi.get('/client/v1/realtime'",
  );
  const agentRoute = section(
    agentSource,
    "agentApi.post('/api/agent/conversations/:id/messages'",
    "agentApi.post('/api/agent/conversations/:id/status'",
  );

  assert.match(
    broadcaster,
    /options: \{[\s\S]*includeOverview\?: boolean;[\s\S]*includeAgentInbox\?: boolean;[\s\S]*previousAgentId\?: string \| null;[\s\S]*conversationSnapshot\?: ConversationEventSnapshot;[\s\S]*\} = \{\}/u,
  );
  assert.match(
    broadcaster,
    /type === 'conversation\.assigned' \|\| type === 'conversation\.closed'/u,
  );
  assert.match(
    broadcaster,
    /conversation\.assigned_agent && includeOverview[\s\S]*loadAgentOverview\(env\.DB, conversation\.assigned_agent\)/u,
  );
  assert.match(
    broadcaster,
    /previousAgentId[\s\S]*loadAgentOverview\(env\.DB, previousAgentId\)/u,
  );
  assert.doesNotMatch(clientRoute, /assignConversationAgent\(/u);
  assert.doesNotMatch(clientRoute, /broadcastAssignments\(/u);
  assert.match(clientRoute, /broadcastClientConversationEvent\(/u);
  assert.match(visitorReadRoute, /includeAgentInbox: false/u);
  assert.doesNotMatch(clientRoute, /includeOverview:\s*true/u);
  assert.match(assignmentBroadcaster, /loadAgentOverview\(env\.DB, agentId\)/u);
  assert.doesNotMatch(
    assignmentBroadcastSource,
    /async function loadAgentOverview/u,
  );
  assert.doesNotMatch(clientSource, /async function loadAgentOverview/u);
  assert.match(agentRoute, /includeOverview: conversation\.status === 'open'/u);
  assert.doesNotMatch(mediaSource, /\{ includeOverview: true \}/u);
  assert.match(
    mediaSource,
    /media\.sender_type === 'agent' &&\s*context\.conversationStatus === 'open'/u,
  );
});
