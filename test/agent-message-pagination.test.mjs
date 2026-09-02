import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeAgentConversationPage } from '../src/dashboard/dashboard-runtime.ts';

function message(id, createdAt, readByVisitorAt = null) {
  return {
    id,
    conversation_id: 'conversation-1',
    sender_type: 'agent',
    sender_id: 'agent-1',
    body: id,
    client_message_id: null,
    read_by_visitor_at: readByVisitorAt,
    read_by_agent_at: null,
    created_at: createdAt,
  };
}

test('older conversation pages merge chronologically and retain updated read state', () => {
  const current = {
    conversation: { id: 'conversation-1', status: 'pending' },
    messages: [
      message('message-3', '2026-01-01T00:00:03.000Z'),
      message('message-4', '2026-01-01T00:00:04.000Z'),
    ],
    media: [],
    readState: [],
    page: {
      hasMoreBefore: true,
      before: {
        id: 'message-3',
        createdAt: '2026-01-01T00:00:03.000Z',
      },
    },
  };
  const earlier = {
    conversation: { id: 'conversation-1', status: 'pending' },
    messages: [
      message('message-1', '2026-01-01T00:00:01.000Z'),
      message('message-2', '2026-01-01T00:00:02.000Z'),
    ],
    media: [],
    readState: [
      {
        id: 'message-3',
        read_by_visitor_at: '2026-01-01T00:01:00.000Z',
        read_by_agent_at: null,
      },
    ],
    page: {
      hasMoreBefore: false,
      before: null,
    },
  };

  const merged = mergeAgentConversationPage(current, earlier, 'before');

  assert.deepEqual(
    merged.messages.map((item) => item.id),
    ['message-1', 'message-2', 'message-3', 'message-4'],
  );
  assert.equal(
    merged.messages.find((item) => item.id === 'message-3')
      ?.read_by_visitor_at,
    '2026-01-01T00:01:00.000Z',
  );
  assert.deepEqual(merged.page, {
    hasMoreBefore: false,
    before: null,
  });
});

test('after-cursor recovery keeps the existing backward-history cursor', () => {
  const current = {
    conversation: { id: 'conversation-1', status: 'pending' },
    messages: [message('message-2', '2026-01-01T00:00:02.000Z')],
    media: [],
    readState: [],
    page: {
      hasMoreBefore: true,
      before: {
        id: 'message-2',
        createdAt: '2026-01-01T00:00:02.000Z',
      },
    },
  };
  const incremental = {
    conversation: { id: 'conversation-1', status: 'pending' },
    messages: [message('message-3', '2026-01-01T00:00:03.000Z')],
    media: [],
    readState: [],
    page: {
      hasMoreBefore: false,
      before: null,
    },
  };

  const merged = mergeAgentConversationPage(current, incremental, 'after');

  assert.deepEqual(
    merged.messages.map((item) => item.id),
    ['message-2', 'message-3'],
  );
  assert.deepEqual(merged.page, current.page);
});
