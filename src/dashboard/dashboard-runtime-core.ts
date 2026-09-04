import type { AgentMediaItem } from './agent-media';
import type {
  AgentAccount,
  AgentAvailability,
  AgentRoutingScope,
  Conversation,
  ConversationDetail,
  Message,
  Overview,
  ProductCatalogItem,
} from './api';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];
type AdminSection = 'agents' | 'workspace';

type AgentDraft = {
  id: string | null;
  name: string;
  adminLabel: string;
  username: string;
  password: string;
  routingScope: AgentRoutingScope;
  dailyConversationLimit: number;
  trafficQuotaEnabled: boolean;
  trafficQuotaTotal: number;
  trafficQuotaUsed: number;
  trafficQuotaTopUp: number;
  trafficQuotaRequestId: string;
  isEnabled: boolean;
};

const emptyAgentDraft: AgentDraft = {
  id: null,
  name: '',
  adminLabel: '',
  username: '',
  password: '',
  routingScope: { type: 'none' },
  dailyConversationLimit: 0,
  trafficQuotaEnabled: true,
  trafficQuotaTotal: 0,
  trafficQuotaUsed: 0,
  trafficQuotaTopUp: 100,
  trafficQuotaRequestId: '',
  isEnabled: true,
};

const filterLabels: Record<Filter, string> = {
  all: '全部',
  open: '新会话',
  pending: '处理中',
  closed: '已关闭',
};

const CHAT_TIME_ZONE = 'America/Los_Angeles';
const AGENT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
const AGENT_TYPING_IDLE_MS = 1400;
const REMOTE_TYPING_STALE_MS = 3000;

type AgentConversationDraft = {
  body: string;
  updatedAt: number;
};

type AgentConversationDrafts = Record<string, AgentConversationDraft>;

type PendingAgentText = {
  conversationId: string;
  clientMessageId: string;
  body: string;
  status: 'sending' | 'failed';
};

function loadAgentConversationDrafts(agentId: string): AgentConversationDrafts {
  try {
    const raw = window.localStorage.getItem(`cs-agent-drafts:${agentId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<
      string,
      { body?: unknown; updatedAt?: unknown }
    >;
    const cutoff = Date.now() - AGENT_DRAFT_TTL_MS;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([conversationId, value]) => {
        if (
          typeof value?.body !== 'string' ||
          !value.body ||
          typeof value.updatedAt !== 'number' ||
          value.updatedAt < cutoff
        ) {
          return [];
        }
        return [
          [conversationId, { body: value.body, updatedAt: value.updatedAt }],
        ];
      }),
    );
  } catch {
    return {};
  }
}

function saveAgentConversationDrafts(
  agentId: string,
  drafts: AgentConversationDrafts,
): void {
  try {
    const key = `cs-agent-drafts:${agentId}`;
    if (Object.keys(drafts).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(drafts));
  } catch {
    // Local drafts are best-effort and must never interrupt active chat work.
  }
}

type AgentDraftSaveTimers = {
  set(callback: () => void, delay: number): number;
  clear(timerId: number): void;
};

function createAgentDraftSaveScheduler(
  save: (
    agentId: string,
    drafts: AgentConversationDrafts,
  ) => void = saveAgentConversationDrafts,
  delayMs = 400,
  timers: AgentDraftSaveTimers = {
    set: (callback, delay) => window.setTimeout(callback, delay),
    clear: (timerId) => window.clearTimeout(timerId),
  },
) {
  let pending: {
    agentId: string;
    drafts: AgentConversationDrafts;
  } | null = null;
  let timerId: number | null = null;

  const clearTimer = () => {
    if (timerId === null) return;
    timers.clear(timerId);
    timerId = null;
  };

  const flush = () => {
    clearTimer();
    const current = pending;
    pending = null;
    if (current) save(current.agentId, current.drafts);
  };

  return {
    schedule(agentId: string, drafts: AgentConversationDrafts) {
      if (pending && pending.agentId !== agentId) flush();
      pending = { agentId, drafts };
      clearTimer();
      timerId = timers.set(() => {
        timerId = null;
        const current = pending;
        pending = null;
        if (current) save(current.agentId, current.drafts);
      }, delayMs);
    },
    flush,
    cancel() {
      clearTimer();
      pending = null;
    },
    hasPending() {
      return pending !== null;
    },
  };
}

function loadAgentSoundEnabled(agentId: string): boolean {
  try {
    return window.localStorage.getItem(`cs-agent-sound:${agentId}`) !== 'off';
  } catch {
    return true;
  }
}

function saveAgentSoundEnabled(agentId: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(
      `cs-agent-sound:${agentId}`,
      enabled ? 'on' : 'off',
    );
  } catch {
    // Sound preference is local-only and must never interrupt reception work.
  }
}

type AgentSoundPreset = 'strong' | 'classic' | 'crisp' | 'triple' | 'soft';

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

const AGENT_SOUND_PRESET_KEY = 'cs-agent-sound-preset';

function isAgentSoundPreset(value: string | null): value is AgentSoundPreset {
  return AGENT_SOUND_PRESET_OPTIONS.some((option) => option.id === value);
}

function loadAgentSoundPreset(): AgentSoundPreset {
  try {
    const value = window.localStorage.getItem(AGENT_SOUND_PRESET_KEY);
    return isAgentSoundPreset(value) ? value : 'strong';
  } catch {
    return 'strong';
  }
}

function saveAgentSoundPreset(preset: AgentSoundPreset): void {
  try {
    window.localStorage.setItem(AGENT_SOUND_PRESET_KEY, preset);
  } catch {
    // Sound preset is device-local and must never interrupt reception work.
  }
}

function loadAgentVibrationEnabled(agentId: string): boolean {
  try {
    return (
      window.localStorage.getItem(`cs-agent-vibration:${agentId}`) !== 'off'
    );
  } catch {
    return true;
  }
}

function saveAgentVibrationEnabled(agentId: string, enabled: boolean): void {
  try {
    window.localStorage.setItem(
      `cs-agent-vibration:${agentId}`,
      enabled ? 'on' : 'off',
    );
  } catch {
    // Vibration preference is local-only and must never interrupt reception work.
  }
}

type AgentReminderType = 'NEW_CONVERSATION' | 'CUSTOMER_REPLY';

function agentReminderVibrationPattern(type: AgentReminderType): number[] {
  return type === 'NEW_CONVERSATION'
    ? [220, 100, 220, 100, 320]
    : [220, 100, 220];
}

function supportsAgentVibration(
  value: { vibrate?: unknown } = navigator,
): boolean {
  return typeof value.vibrate === 'function';
}

function rememberAgentReminderMessage(
  seen: Set<string>,
  messageId: string,
  maxRemembered = 500,
): boolean {
  if (!messageId || seen.has(messageId)) return false;
  seen.add(messageId);
  if (seen.size > maxRemembered) {
    const oldest = seen.values().next().value;
    if (oldest) seen.delete(oldest);
  }
  return true;
}

type AgentToneProfile = {
  waveform: OscillatorType;
  peak: number;
  release: number;
  noteDuration: number;
  notes: readonly (readonly [frequency: number, offset: number])[];
};

function agentToneProfile(
  preset: AgentSoundPreset,
  type: AgentReminderType,
): AgentToneProfile {
  const isNewConversation = type === 'NEW_CONVERSATION';
  switch (preset) {
    case 'classic':
      return {
        waveform: 'sine',
        peak: 0.92,
        release: isNewConversation ? 0.42 : 0.28,
        noteDuration: 0.08,
        notes: isNewConversation
          ? [
              [880, 0],
              [1319, 0.27],
            ]
          : [
              [784, 0],
              [1047, 0.17],
            ],
      };
    case 'crisp':
      return {
        waveform: 'triangle',
        peak: 0.88,
        release: isNewConversation ? 0.4 : 0.26,
        noteDuration: 0.06,
        notes: isNewConversation
          ? [
              [1319, 0],
              [2093, 0.2],
            ]
          : [
              [1319, 0],
              [1760, 0.14],
            ],
      };
    case 'triple':
      return {
        waveform: 'sine',
        peak: 0.96,
        release: isNewConversation ? 0.48 : 0.34,
        noteDuration: 0.065,
        notes: isNewConversation
          ? [
              [659, 0],
              [880, 0.17],
              [1175, 0.34],
            ]
          : [
              [659, 0],
              [880, 0.12],
              [1175, 0.24],
            ],
      };
    case 'soft':
      return {
        waveform: 'sine',
        peak: 0.55,
        release: isNewConversation ? 0.5 : 0.34,
        noteDuration: 0.09,
        notes: isNewConversation
          ? [
              [523, 0],
              [784, 0.26],
            ]
          : [
              [523, 0],
              [659, 0.18],
            ],
      };
    case 'strong':
    default:
      return {
        waveform: 'triangle',
        peak: 1,
        release: isNewConversation ? 0.5 : 0.34,
        noteDuration: 0.07,
        notes: isNewConversation
          ? [
              [880, 0],
              [1175, 0.12],
              [1568, 0.24],
              [1760, 0.36],
            ]
          : [
              [880, 0],
              [1175, 0.12],
              [1568, 0.24],
            ],
      };
  }
}

function emitAgentMessageTone(
  context: AudioContext,
  type: AgentReminderType = 'CUSTOMER_REPLY',
  preset: AgentSoundPreset = loadAgentSoundPreset(),
): void {
  const now = context.currentTime;
  const profile = agentToneProfile(preset, type);
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(profile.peak, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.release);
  gain.connect(context.destination);

  for (const [frequency, offset] of profile.notes) {
    const oscillator = context.createOscillator();
    oscillator.type = profile.waveform;
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    oscillator.connect(gain);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + profile.noteDuration);
  }
}

type InboxRealtimeEvent = {
  type?: string;
  cause?: 'initial_assignment' | 'assignment';
  agentId?: string;
  availability?: AgentAvailability;
  updatedAt?: string;
  conversation?: Conversation;
  overview?: Overview | null;
  reminder?: {
    type: AgentReminderType;
    messageId: string;
  };
};

type ThreadRealtimeEvent = {
  type?: string;
  message?: Message;
  media?: Omit<AgentMediaItem, 'url'>;
  reader?: 'agent' | 'visitor';
  lastMessageId?: string | null;
  status?: Conversation['status'];
  actor?: 'agent' | 'visitor';
  active?: boolean;
};

function parseRealtimeEvent<T>(event: MessageEvent): T | null {
  try {
    return JSON.parse(String(event.data)) as T;
  } catch {
    return null;
  }
}

function sortedConversationList(items: Conversation[]): Conversation[] {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.last_message_at || left.created_at);
    const rightTime = Date.parse(right.last_message_at || right.created_at);
    return rightTime - leftTime;
  });
}

function compareMessages(left: Message, right: Message): number {
  const difference = Date.parse(left.created_at) - Date.parse(right.created_at);
  return difference || left.id.localeCompare(right.id);
}

function mergeAgentConversationPage(
  current: ConversationDetail,
  incoming: ConversationDetail,
  direction: 'before' | 'after',
): ConversationDetail {
  const messages = new Map(current.messages.map((item) => [item.id, item]));
  for (const readState of incoming.readState ?? []) {
    const existing = messages.get(readState.id);
    if (existing) messages.set(readState.id, { ...existing, ...readState });
  }
  for (const item of incoming.messages) messages.set(item.id, item);

  return {
    ...incoming,
    messages: [...messages.values()].sort(compareMessages),
    page: direction === 'after' ? current.page : incoming.page,
  };
}

function mergeAgentOverview(current: Overview, realtime: Overview): Overview {
  return { ...current, ...realtime };
}

type AgentScopeSummary = {
  tone: 'none' | 'section' | 'category' | 'product';
  title: string;
  detail: string;
};

function productsForScope(
  scope: AgentRoutingScope,
  products: ProductCatalogItem[],
): ProductCatalogItem[] {
  if (scope.type === 'none') return [];
  if (scope.type === 'product') {
    const ids = new Set(scope.productIds);
    return products.filter(
      (product) => product.isEnabled && ids.has(product.id),
    );
  }
  if (scope.type === 'section') {
    const sectionIds = new Set(scope.sectionIds);
    return products.filter(
      (product) =>
        product.isEnabled &&
        Boolean(product.sectionId) &&
        sectionIds.has(product.sectionId as string),
    );
  }
  const categoryIds = new Set(scope.categoryIds);
  return products.filter(
    (product) =>
      product.isEnabled &&
      product.sectionId === scope.sectionId &&
      Boolean(product.categoryId) &&
      categoryIds.has(product.categoryId as string),
  );
}

function scopeProductCount(
  scope: AgentRoutingScope,
  products: ProductCatalogItem[],
): number {
  return productsForScope(scope, products).length;
}

function agentScopeSummary(
  agent: AgentAccount,
  products: ProductCatalogItem[],
): AgentScopeSummary {
  const scope = agent.routingScope;
  if (!scope || scope.type === 'none') {
    return {
      tone: 'none',
      title: '未配置负责范围',
      detail: '不会参与基于产品范围的新会话分流',
    };
  }

  if (scope.type === 'section') {
    const sectionNames = scope.sectionIds.map((sectionId) => {
      const product = products.find((item) => item.sectionId === sectionId);
      return product?.sectionName || sectionId;
    });
    const title =
      sectionNames.length === 1
        ? `${sectionNames[0]} · 整个分区`
        : `${sectionNames.slice(0, 2).join('、')}${sectionNames.length > 2 ? ` 等 ${sectionNames.length} 个分区` : ''}`;
    return {
      tone: 'section',
      title,
      detail: `${scope.sectionIds.length} 个分区 · 动态覆盖 ${scopeProductCount(scope, products)} 个产品`,
    };
  }

  if (scope.type === 'category') {
    const sectionProduct = products.find(
      (item) => item.sectionId === scope.sectionId,
    );
    const sectionName = sectionProduct?.sectionName || scope.sectionId;
    const names = scope.categoryIds.map((categoryId) => {
      const product = products.find(
        (item) =>
          item.sectionId === scope.sectionId && item.categoryId === categoryId,
      );
      return product?.categoryName || categoryId;
    });
    const visible = names.slice(0, 2).join('、');
    const remainder = Math.max(0, names.length - 2);
    return {
      tone: 'category',
      title: `${sectionName} · ${scope.categoryIds.length} 个分类`,
      detail: `${visible}${remainder ? ` 等 ${names.length} 个分类` : ''} · 动态覆盖 ${scopeProductCount(scope, products)} 个产品`,
    };
  }

  const names = scope.productIds.map(
    (productId) =>
      products.find((item) => item.id === productId)?.title || productId,
  );
  const visible = names.slice(0, 2).join('、');
  const remainder = Math.max(0, names.length - 2);
  return {
    tone: 'product',
    title: `指定 ${scope.productIds.length} 个产品`,
    detail: names.length
      ? `${visible}${remainder ? ` 等 ${names.length} 个产品` : ''}`
      : '未选择产品',
  };
}

function presenceClass(agent: AgentAccount): string {
  if (!agent.isEnabled) return 'offline';
  return agent.status;
}

function statusLabel(status: AgentAccount['status']): string {
  if (status === 'online') return '在线';
  if (status === 'busy') return '忙碌';
  return '离线';
}

function initials(value: string): string {
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, 2).join('').toUpperCase() : '访';
}

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CHAT_TIME_ZONE,
  }).format(new Date(value));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('zh-CN', {
        timeZone: CHAT_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export type {
  LoadState,
  Filter,
  AdminSection,
  AgentDraft,
  AgentConversationDrafts,
  PendingAgentText,
  InboxRealtimeEvent,
  ThreadRealtimeEvent,
  AgentSoundPreset,
};

export {
  emptyAgentDraft,
  filterLabels,
  CHAT_TIME_ZONE,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  createAgentDraftSaveScheduler,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  AGENT_SOUND_PRESET_OPTIONS,
  loadAgentSoundPreset,
  saveAgentSoundPreset,
  loadAgentVibrationEnabled,
  saveAgentVibrationEnabled,
  agentReminderVibrationPattern,
  supportsAgentVibration,
  rememberAgentReminderMessage,
  emitAgentMessageTone,
  type AgentReminderType,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  mergeAgentConversationPage,
  mergeAgentOverview,
  productsForScope,
  agentScopeSummary,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  formatTime,
  message,
};
