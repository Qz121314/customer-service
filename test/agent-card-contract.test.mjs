import assert from 'node:assert/strict';
import test from 'node:test';
import { agentContactCardHref } from '../src/dashboard/agent-attachments-client.ts';
import {
  decodeContactCardIconRef,
  encodeContactCardIconRef,
  hasContactCardIconRef,
} from '../src/worker/contact-card-icon.ts';

test('agent contact cards map SMS numbers and links to clickable destinations', () => {
  assert.equal(
    agentContactCardHref({
      id: 'sms-card',
      kind: 'phone',
      label: '短信联系',
      value: '+12135551234',
    }),
    'sms:+12135551234',
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

test('contact card icon references expose only validated internal R2 objects', () => {
  const marker = encodeContactCardIconRef({
    objectKey: 'agent-card-icons/agent-1/card-1/icon-1.png',
    mimeType: 'image/png',
  });
  assert.equal(hasContactCardIconRef(marker), true);
  assert.deepEqual(decodeContactCardIconRef(marker), {
    objectKey: 'agent-card-icons/agent-1/card-1/icon-1.png',
    mimeType: 'image/png',
  });
  assert.equal(
    decodeContactCardIconRef('contact-card-icon:v1:png:other-bucket/icon.png'),
    null,
  );
  assert.equal(decodeContactCardIconRef('not-a-card-icon'), null);
});
