import {
  emitAgentMessageTone as emitSyntheticAgentMessageTone,
  loadAgentSoundPreset,
  type AgentReminderType,
  type AgentSoundPreset,
} from './dashboard-runtime-core';

export * from './dashboard-runtime-core';

const AGENT_SOUND_PRESET_OPTIONS: readonly {
  id: AgentSoundPreset;
  label: string;
}[] = [
  { id: 'strong', label: '强提醒' },
  { id: 'classic', label: '经典双音' },
  { id: 'crisp', label: '清脆提示' },
  { id: 'triple', label: '三连音' },
  { id: 'soft', label: '柔和水滴' },
];

const AGENT_SOUND_ASSET_PATHS: Readonly<Record<AgentSoundPreset, string>> = {
  strong: '/agent-sounds/strong.wav',
  classic: '/agent-sounds/classic.wav',
  crisp: '/agent-sounds/crisp.wav',
  triple: '/agent-sounds/triple.wav',
  soft: '/agent-sounds/soft.wav',
};

type AgentSoundAssetPlan = {
  path: string;
  repeats: number;
  gapMs: number;
  gain: number;
};

type AgentSoundAssetRuntime = {
  fetchAsset?: (path: string) => Promise<ArrayBuffer>;
  wait?: (delayMs: number) => Promise<void>;
};

const assetBufferCache = new WeakMap<
  AudioContext,
  Map<AgentSoundPreset, Promise<AudioBuffer>>
>();

function agentSoundAssetPlan(
  preset: AgentSoundPreset,
  type: AgentReminderType,
): AgentSoundAssetPlan {
  const isNewConversation = type === 'NEW_CONVERSATION';
  switch (preset) {
    case 'classic':
      return {
        path: AGENT_SOUND_ASSET_PATHS.classic,
        repeats: 2,
        gapMs: isNewConversation ? 180 : 90,
        gain: 0.92,
      };
    case 'crisp':
      return {
        path: AGENT_SOUND_ASSET_PATHS.crisp,
        repeats: isNewConversation ? 2 : 1,
        gapMs: 140,
        gain: 0.9,
      };
    case 'triple':
      return {
        path: AGENT_SOUND_ASSET_PATHS.triple,
        repeats: 3,
        gapMs: isNewConversation ? 160 : 85,
        gain: 0.95,
      };
    case 'soft':
      return {
        path: AGENT_SOUND_ASSET_PATHS.soft,
        repeats: isNewConversation ? 2 : 1,
        gapMs: 220,
        gain: 0.72,
      };
    case 'strong':
    default:
      return {
        path: AGENT_SOUND_ASSET_PATHS.strong,
        repeats: isNewConversation ? 3 : 2,
        gapMs: isNewConversation ? 130 : 80,
        gain: 1,
      };
  }
}

async function fetchAgentSoundAsset(path: string): Promise<ArrayBuffer> {
  const response = await fetch(path, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Unable to load agent sound asset: ${response.status}`);
  }
  return response.arrayBuffer();
}

function waitForAgentSoundGap(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

async function loadAgentSoundBuffer(
  context: AudioContext,
  preset: AgentSoundPreset,
): Promise<AudioBuffer> {
  let cache = assetBufferCache.get(context);
  if (!cache) {
    cache = new Map();
    assetBufferCache.set(context, cache);
  }
  const cached = cache.get(preset);
  if (cached) return cached;

  const path = AGENT_SOUND_ASSET_PATHS[preset];
  const pending = fetchAgentSoundAsset(path)
    .then((bytes) => context.decodeAudioData(bytes))
    .catch((reason) => {
      cache?.delete(preset);
      throw reason;
    });
  cache.set(preset, pending);
  return pending;
}

async function playAgentSoundAssetSequence(
  context: AudioContext,
  type: AgentReminderType,
  preset: AgentSoundPreset,
  runtime: AgentSoundAssetRuntime = {},
): Promise<boolean> {
  if (
    typeof context.createBufferSource !== 'function' ||
    typeof context.createGain !== 'function' ||
    typeof context.decodeAudioData !== 'function'
  ) {
    return false;
  }

  const plan = agentSoundAssetPlan(preset, type);
  const wait = runtime.wait ?? waitForAgentSoundGap;

  try {
    const buffer = runtime.fetchAsset
      ? await context.decodeAudioData(await runtime.fetchAsset(plan.path))
      : await loadAgentSoundBuffer(context, preset);

    for (let index = 0; index < plan.repeats; index += 1) {
      await new Promise<void>((resolve) => {
        const source = context.createBufferSource();
        const gain = context.createGain();
        source.buffer = buffer;
        gain.gain.setValueAtTime(plan.gain, context.currentTime);
        source.connect(gain);
        gain.connect(context.destination);
        source.onended = () => resolve();
        source.start();
      });
      if (index + 1 < plan.repeats) await wait(plan.gapMs);
    }
    return true;
  } catch {
    return false;
  }
}

function emitAgentMessageTone(
  context: AudioContext,
  type: AgentReminderType = 'CUSTOMER_REPLY',
  preset: AgentSoundPreset = loadAgentSoundPreset(),
): void {
  if (
    typeof context.createBufferSource !== 'function' ||
    typeof context.decodeAudioData !== 'function' ||
    typeof fetch !== 'function'
  ) {
    emitSyntheticAgentMessageTone(context, type, preset);
    return;
  }

  void playAgentSoundAssetSequence(context, type, preset).then((played) => {
    if (!played) emitSyntheticAgentMessageTone(context, type, preset);
  });
}

export {
  AGENT_SOUND_PRESET_OPTIONS,
  AGENT_SOUND_ASSET_PATHS,
  agentSoundAssetPlan,
  playAgentSoundAssetSequence,
  emitAgentMessageTone,
};
