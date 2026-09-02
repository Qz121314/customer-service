import assert from 'node:assert/strict';
import test from 'node:test';
import {
  expiredConversationIds,
  nextConversationExpiryAt,
} from '../src/dashboard/agent-conversation-expiry.ts';

const now = Date.parse('2026-09-02T16:00:00.000Z');

test('expired conversations leave the agent inbox at their exact lifecycle boundary', () => {
  const conversations = [
    { id: 'expired', expires_at: '2026-09-02T15:59:59.999Z' },
    { id: 'boundary', expires_at: '2026-09-02T16:00:00.000Z' },
    { id: 'active', expires_at: '2026-09-02T16:00:00.001Z' },
    { id: 'legacy', expires_at: null },
  ];

  assert.deepEqual([...expiredConversationIds(conversations, now)].sort(), [
    'boundary',
    'expired',
  ]);
  assert.equal(nextConversationExpiryAt(conversations, now), now + 1);
});
