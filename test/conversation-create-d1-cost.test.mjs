import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clientSource = readFileSync('src/worker/client-api.ts', 'utf8');

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

test('CTA conversation start does not require a synthetic visitor message', () => {
  const route = section(
    clientSource,
    "clientApi.post('/client/v1/conversations'",
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );
  const optionalMessageValidation = section(
    route,
    'if (messageFieldPresent || clientMessageFieldPresent)',
    'if (!productInput)',
  );

  assert.match(
    route,
    /const messageFieldPresent = body\?\.message !== undefined/u,
  );
  assert.match(route, /const hasInitialMessage = Boolean\(initialMessage\)/u);
  assert.match(
    route,
    /if \(messageFieldPresent \|\| clientMessageFieldPresent\)/u,
  );
  assert.match(optionalMessageValidation, /if \(!clientMessageId\)/u);
  assert.match(
    route,
    /if \(hasInitialMessage && clientMessageId && initialMessage\)/u,
  );
});

test('assigned conversation start reuses the assignment lifecycle snapshot', () => {
  const route = section(
    clientSource,
    'const assignment = await assignConversationAgent',
    "clientApi.post('/client/v1/conversations/:id/messages'",
  );

  assert.match(route, /const snapshots = await broadcastAssignments/u);
  assert.match(route, /conversation = snapshots\.find/u);
  assert.match(route, /assignment\?\.newlyAssigned && assignment\.assignedAt/u);
  const assignedBranch = section(
    route,
    'if (assignment?.newlyAssigned && assignment.assignedAt)',
    '} else if (createdMessage)',
  );
  assert.doesNotMatch(assignedBranch, /ownedConversation\(/u);
  assert.doesNotMatch(assignedBranch, /broadcastClientConversationEvent\(/u);
});
