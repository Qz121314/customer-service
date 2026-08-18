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

test('agent text sends use a slim ownership read and do not reread inserted messages', () => {
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

  assert.match(route, /assignedConversationForMessageWrite\(/u);
  assert.doesNotMatch(route, /assignedConversation\(c\.env\.DB/u);
  assert.match(route, /client_message_id, created_at/u);
  assert.match(route, /const message: MessageRow = \{/u);
  assert.doesNotMatch(route, /FROM messages WHERE id = \?1/u);
  assert.match(helper, /SELECT id, status\s+FROM conversations/u);
  assert.doesNotMatch(helper, /JOIN visitors/u);
  assert.doesNotMatch(helper, /SELECT c\.\*/u);
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
  assert.doesNotMatch(ownership, /last_message/u);
  assert.doesNotMatch(ownership, /LEFT JOIN agents/u);
});

test('realtime overview scans run only when assignment or status counts can change', () => {
  const broadcaster = section(
    clientSource,
    'export async function broadcastClientConversationEvent(',
    'async function loadAgentOverview(',
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
  const agentRoute = section(
    agentSource,
    "agentApi.post('/api/agent/conversations/:id/messages'",
    "agentApi.post('/api/agent/conversations/:id/status'",
  );

  assert.match(
    broadcaster,
    /options: \{[\s\S]*includeOverview\?: boolean;[\s\S]*previousAgentId\?: string \| null;[\s\S]*\} = \{\}/u,
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
  assert.match(
    clientRoute,
    /if \(assignment\?\.newlyAssigned && assignment\.assignedAt\)[\s\S]*broadcastAssignments\([\s\S]*\} else \{[\s\S]*broadcastClientConversationEvent\(/u,
  );
  assert.doesNotMatch(clientRoute, /includeOverview:\s*true/u);
  assert.match(assignmentBroadcaster, /loadAgentOverview\(env\.DB, agentId\)/u);
  assert.match(agentRoute, /includeOverview: conversation\.status === 'open'/u);
  assert.doesNotMatch(mediaSource, /\{ includeOverview: true \}/u);
  assert.match(
    mediaSource,
    /media\.sender_type === 'agent' &&\s*context\.conversationStatus === 'open'/u,
  );
});
