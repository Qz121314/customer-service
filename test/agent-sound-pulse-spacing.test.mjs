import assert from 'node:assert/strict';
import test from 'node:test';
import { emitAgentMessageTone } from '../src/dashboard/dashboard-runtime.ts';

function captureTone(type = 'CUSTOMER_REPLY') {
  const starts = [];
  const stops = [];
  const context = {
    currentTime: 0,
    destination: {},
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
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
  emitAgentMessageTone(context, type);
  return { starts, stops };
}

test('single fallback tone keeps its pulses audibly separated', () => {
  const tone = captureTone();
  assert.equal(tone.starts.length, 3);
  for (let index = 1; index < tone.starts.length; index += 1) {
    assert.ok(tone.starts[index] - tone.stops[index - 1] >= 0.035);
  }
});

test('new conversations remain more prominent than replies', () => {
  assert.equal(captureTone('NEW_CONVERSATION').starts.length, 4);
});
