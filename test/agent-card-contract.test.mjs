import assert from 'node:assert/strict';
import test from 'node:test';
import { agentContactCardHref } from '../src/dashboard/agent-attachments-client.ts';

test('agent contact cards map phone numbers and links to clickable destinations', () => {
  assert.equal(
    agentContactCardHref({
      id: 'phone-card',
      kind: 'phone',
      label: '联系电话',
      value: '+12135551234',
    }),
    'tel:+12135551234',
  );
  assert.equal(
    agentContactCardHref({
      id: 'link-card',
      kind: 'link',
      label: '付款链接',
      value: 'https://example.com/pay',
    }),
    'https://example.com/pay',
  );
});
