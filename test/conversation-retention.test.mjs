import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONVERSATION_LIFETIME_HOURS,
  conversationExpiresAt,
} from '../src/worker/conversation-retention.ts';

test('conversation expiry is fixed at 24 hours after creation', () => {
  assert.equal(CONVERSATION_LIFETIME_HOURS, 24);
  assert.equal(
    conversationExpiresAt('2026-08-14T10:00:00.000Z'),
    '2026-08-15T10:00:00.000Z',
  );
});
