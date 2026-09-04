import assert from 'node:assert/strict';
import test from 'node:test';
import { emitAgentMessageTone } from '../src/dashboard/dashboard-runtime.ts';

function captureTone(preset, type = 'CUSTOMER_REPLY') {
  const starts = [];
  const stops = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    },
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime() {} },
        connect() {},
        start(time) {
          starts.push(time);
        },
        stop(time) {
          stops.push(time);
        },
      };
    },
  };

  emitAgentMessageTone(context, type, preset);
  return { starts, stops };
}

function assertAudibleGaps(tone, expectedPulses) {
  assert.equal(tone.starts.length, expectedPulses);
  assert.equal(tone.stops.length, expectedPulses);
  for (let index = 1; index < tone.starts.length; index += 1) {
    assert.ok(
      tone.starts[index] > tone.stops[index - 1],
      `pulse ${index + 1} must start after pulse ${index} stops`,
    );
    assert.ok(
      tone.starts[index] - tone.stops[index - 1] >= 0.035,
      `pulse ${index + 1} needs an audible silent gap`,
    );
  }
}

test('classic customer reply is two clearly separated pulses', () => {
  assertAudibleGaps(captureTone('classic'), 2);
});

test('triple customer reply is three clearly separated pulses', () => {
  assertAudibleGaps(captureTone('triple'), 3);
});

test('strong alert pulses are separated instead of blending into one tone', () => {
  assertAudibleGaps(captureTone('strong'), 3);
});

test('new-conversation rhythm stays longer than reply rhythm', () => {
  const reply = captureTone('triple', 'CUSTOMER_REPLY');
  const newConversation = captureTone('triple', 'NEW_CONVERSATION');
  assert.equal(newConversation.starts.length, 3);
  assert.ok(
    newConversation.starts.at(-1) > reply.starts.at(-1),
    'new-conversation triple tone should use a wider cadence',
  );
});
