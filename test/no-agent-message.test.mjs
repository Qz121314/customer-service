import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_NO_AGENT_MESSAGE,
  MAX_NO_AGENT_MESSAGE_LENGTH,
  normalizeNoAgentMessage,
  normalizeNoAgentMessageFormat,
} from '../src/worker/no-agent-message.ts';

test('no-agent messages preserve authored Markdown while trimming outer whitespace', () => {
  assert.equal(
    normalizeNoAgentMessage('  **暂时离开**\n\n请稍后再试。  '),
    '**暂时离开**\n\n请稍后再试。',
  );
  assert.equal(normalizeNoAgentMessageFormat('markdown'), 'markdown');
});

test('no-agent messages require non-empty bounded content and a known format', () => {
  assert.equal(normalizeNoAgentMessage('   '), null);
  assert.equal(
    normalizeNoAgentMessage('x'.repeat(MAX_NO_AGENT_MESSAGE_LENGTH + 1)),
    null,
  );
  assert.equal(normalizeNoAgentMessageFormat('html'), null);
  assert.equal(DEFAULT_NO_AGENT_MESSAGE.length > 0, true);
});
