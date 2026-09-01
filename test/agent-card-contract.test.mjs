import assert from 'node:assert/strict';
import test from 'node:test';
import { agentContactCardHref } from '../src/dashboard/agent-attachments-client.ts';
import {
  decodeContactCardIconRef,
  encodeContactCardIconRef,
  hasContactCardIconRef,
} from '../src/worker/contact-card-icon.ts';
import {
  normalizeContactCardValue,
  normalizePresetMessage,
} from '../src/worker/message-attachments.ts';

test('contact card values normalize by final channel contract', () => {
  assert.equal(
    normalizeContactCardValue('sms', '+1 (213) 555-1234'),
    '+12135551234',
  );
  assert.equal(
    normalizeContactCardValue('whatsapp', '+1 (213) 555-1234'),
    '+12135551234',
  );
  assert.equal(
    normalizeContactCardValue('telegram', '@support_team'),
    'support_team',
  );
  assert.equal(
    normalizeContactCardValue('website', 'https://example.com/contact'),
    'https://example.com/contact',
  );

  assert.equal(normalizeContactCardValue('telegram', 'bad user'), null);
  assert.equal(
    normalizeContactCardValue('website', 'javascript:alert(1)'),
    null,
  );
});

test('prefilled messages are optional, trimmed and bounded', () => {
  assert.equal(normalizePresetMessage(undefined), null);
  assert.equal(normalizePresetMessage('   '), null);
  assert.equal(normalizePresetMessage('  Hello there  '), 'Hello there');
  assert.equal(normalizePresetMessage('x'.repeat(2001)), null);
});

test('agent contact cards map final channels to safe clickable destinations', () => {
  const sms = agentContactCardHref({
    id: 'sms-card',
    kind: 'sms',
    label: '短信联系',
    value: '+12135551234',
    presetMessage: 'Hello there',
  });
  assert.equal(sms, 'sms:+12135551234?body=Hello%20there');
  assert.equal(sms.startsWith('tel:'), false);

  assert.equal(
    agentContactCardHref({
      id: 'wa-card',
      kind: 'whatsapp',
      label: 'WhatsApp',
      value: '+12135551234',
      presetMessage: 'Need more info',
    }),
    'https://wa.me/12135551234?text=Need%20more%20info',
  );

  assert.equal(
    agentContactCardHref({
      id: 'tg-card',
      kind: 'telegram',
      label: 'Telegram',
      value: 'support_team',
      presetMessage: 'Hello',
    }),
    'https://t.me/support_team?text=Hello',
  );

  assert.equal(
    agentContactCardHref({
      id: 'site-card',
      kind: 'website',
      label: '网站',
      value: 'https://example.com/contact',
      presetMessage: null,
    }),
    'https://example.com/contact',
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
