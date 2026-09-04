import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { rememberAgentReminderMessage } from '../src/dashboard/dashboard-runtime.ts';

function threadMessageHandlerSource() {
  const portal = readFileSync(
    new URL('../src/dashboard/AgentPortal.tsx', import.meta.url),
    'utf8',
  );
  const handlerStart = portal.indexOf(
    "if (payload.type === 'message' && payload.message)",
  );
  const handlerEnd = portal.indexOf(
    "if (payload.type === 'message.read')",
    handlerStart,
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  return portal.slice(handlerStart, handlerEnd);
}

test('live visitor thread messages trigger the shared customer reply reminder', () => {
  const handler = threadMessageHandlerSource();
  const visitorStart = handler.indexOf("if (incoming.sender_type === 'visitor')");
  const clientMessageStart = handler.indexOf('if (incoming.client_message_id)');
  assert.ok(visitorStart >= 0 && clientMessageStart > visitorStart);

  const visitorBlock = handler.slice(visitorStart, clientMessageStart);
  assert.match(
    visitorBlock,
    /alertForReminder\('CUSTOMER_REPLY', incoming\.id\);/u,
  );
});

test('thread reminder stays scoped to visitor messages, not agent or non-message events', () => {
  const handler = threadMessageHandlerSource();
  const reminderCall = "alertForReminder('CUSTOMER_REPLY', incoming.id);";
  assert.equal(handler.split(reminderCall).length - 1, 1);

  const visitorStart = handler.indexOf("if (incoming.sender_type === 'visitor')");
  const visitorEnd = handler.indexOf('if (incoming.client_message_id)');
  const reminderIndex = handler.indexOf(reminderCall);
  assert.ok(reminderIndex > visitorStart && reminderIndex < visitorEnd);
});

test('thread and inbox delivery of the same message id still alerts only once', () => {
  const seen = new Set();

  assert.equal(rememberAgentReminderMessage(seen, 'message-a'), true);
  assert.equal(rememberAgentReminderMessage(seen, 'message-a'), false);
  assert.equal(rememberAgentReminderMessage(seen, 'message-b'), true);
  assert.equal(rememberAgentReminderMessage(seen, 'message-c'), true);
  assert.equal(seen.size, 3);
});
