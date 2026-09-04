import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import {
  AGENT_SOUND_ASSET_PATHS,
  agentSoundAssetPlan,
  playAgentSoundAssetSequence,
} from '../src/dashboard/dashboard-runtime.ts';

const presets = ['strong', 'classic', 'crisp', 'triple', 'soft'];

test('bundled agent sound assets are valid WAV files', () => {
  for (const preset of presets) {
    const path = AGENT_SOUND_ASSET_PATHS[preset];
    assert.equal(path, `/agent-sounds/${preset}.wav`);
    const bytes = readFileSync(
      new URL(`../public/agent-sounds/${preset}.wav`, import.meta.url),
    );
    assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.ok(bytes.length > 1_000);
  }
});

test('asset plans preserve distinct customer-reply cadences', () => {
  assert.deepEqual(agentSoundAssetPlan('classic', 'CUSTOMER_REPLY'), {
    path: '/agent-sounds/classic.wav',
    repeats: 2,
    gapMs: 90,
    gain: 0.92,
  });
  assert.equal(agentSoundAssetPlan('triple', 'CUSTOMER_REPLY').repeats, 3);
  assert.equal(agentSoundAssetPlan('strong', 'CUSTOMER_REPLY').repeats, 2);
  assert.equal(agentSoundAssetPlan('crisp', 'CUSTOMER_REPLY').repeats, 1);
  assert.equal(agentSoundAssetPlan('soft', 'CUSTOMER_REPLY').repeats, 1);
});

test('new-conversation asset cadence stays more prominent than a reply', () => {
  const classicReply = agentSoundAssetPlan('classic', 'CUSTOMER_REPLY');
  const classicNew = agentSoundAssetPlan('classic', 'NEW_CONVERSATION');
  assert.equal(classicNew.repeats, 2);
  assert.ok(classicNew.gapMs > classicReply.gapMs);

  const strongReply = agentSoundAssetPlan('strong', 'CUSTOMER_REPLY');
  const strongNew = agentSoundAssetPlan('strong', 'NEW_CONVERSATION');
  assert.ok(strongNew.repeats > strongReply.repeats);
});

test('decoded WAV asset plays as discrete sequential pulses', async () => {
  const starts = [];
  const waits = [];
  const gains = [];
  const context = {
    currentTime: 4,
    destination: {},
    createBufferSource() {
      const source = {
        buffer: null,
        onended: null,
        connect() {},
        start() {
          starts.push(starts.length + 1);
          queueMicrotask(() => source.onended?.());
        },
      };
      return source;
    },
    createGain() {
      return {
        gain: {
          setValueAtTime(value, time) {
            gains.push({ value, time });
          },
        },
        connect() {},
      };
    },
    async decodeAudioData(bytes) {
      assert.equal(bytes.byteLength, 8);
      return { duration: 0.02 };
    },
  };

  const played = await playAgentSoundAssetSequence(
    context,
    'CUSTOMER_REPLY',
    'triple',
    {
      async fetchAsset(path) {
        assert.equal(path, '/agent-sounds/triple.wav');
        return new ArrayBuffer(8);
      },
      async wait(delayMs) {
        waits.push(delayMs);
      },
    },
  );

  assert.equal(played, true);
  assert.deepEqual(starts, [1, 2, 3]);
  assert.deepEqual(waits, [85, 85]);
  assert.deepEqual(gains, [
    { value: 0.95, time: 4 },
    { value: 0.95, time: 4 },
    { value: 0.95, time: 4 },
  ]);
});

test('asset playback failure reports false so the synthesized fallback can run', async () => {
  const context = {
    currentTime: 0,
    destination: {},
    createBufferSource() {},
    createGain() {},
    async decodeAudioData() {
      return {};
    },
  };

  assert.equal(
    await playAgentSoundAssetSequence(context, 'CUSTOMER_REPLY', 'crisp', {
      async fetchAsset() {
        throw new Error('asset unavailable');
      },
    }),
    false,
  );
});
