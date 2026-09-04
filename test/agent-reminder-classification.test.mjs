import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agentNotificationForConversationStart,
  agentNotificationForVisitorResponse,
} from '../src/worker/agent-notification-event.ts';

test('every durable visitor text message carries exact customer-reply identity', async () => {
  for (const [messageId, body] of [
    ['message-1', 'Hello'],
    ['message-2', 'Are you available?'],
    ['message-3', 'Today?'],
  ]) {
    const notification = await agentNotificationForVisitorResponse(
      '/client/v1/conversations/conversation-1/messages',
      Response.json({ message: { id: messageId, body } }, { status: 201 }),
    );
    assert.deepEqual(notification, {
      type: 'CUSTOMER_REPLY',
      conversationId: 'conversation-1',
      messageId,
      preview: body,
    });
  }
});

test('conversation starts notify exactly once from durable message identity', () => {
  const created = agentNotificationForConversationStart({
    conversationId: 'conversation-new',
    message: { id: 'message-new', body: 'Need help' },
    newlyAssigned: true,
  });
  assert.deepEqual(created, {
    type: 'NEW_CONVERSATION',
    conversationId: 'conversation-new',
    messageId: 'message-new',
    preview: 'Need help',
  });

  const reused = agentNotificationForConversationStart({
    conversationId: 'conversation-new',
    message: { id: 'message-reused', body: 'Still there?' },
    newlyAssigned: false,
  });
  assert.deepEqual(reused, {
    type: 'CUSTOMER_REPLY',
    conversationId: 'conversation-new',
    messageId: 'message-reused',
    preview: 'Still there?',
  });

  const duplicate = agentNotificationForConversationStart({
    conversationId: 'conversation-new',
    message: null,
    newlyAssigned: false,
  });
  assert.equal(duplicate, null);
});

test('durable visitor media notifies once with an image preview', async () => {
  const delivered = await agentNotificationForVisitorResponse(
    '/client/v1/media/upload-1/complete',
    Response.json({
      conversationId: 'conversation-media',
      messageId: 'message-media',
      duplicate: false,
    }),
  );
  assert.deepEqual(delivered, {
    type: 'CUSTOMER_REPLY',
    conversationId: 'conversation-media',
    messageId: 'message-media',
    preview: '客户发送了一张图片',
  });

  const duplicate = await agentNotificationForVisitorResponse(
    '/client/v1/media/upload-1/complete',
    Response.json({
      conversationId: 'conversation-media',
      messageId: 'message-media',
      duplicate: true,
    }),
  );
  assert.equal(duplicate, null);
});
