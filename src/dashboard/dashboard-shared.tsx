import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type {
  AgentAccount,
  AgentRoutingScope,
  Conversation,
  Message,
  Overview,
  ProductCatalogItem,
} from './api';
import type { AgentMediaItem } from './agent-media';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];
type AdminSection = 'agents' | 'workspace';
type UiIconName =
  | 'agents'
  | 'statistics'
  | 'workspace'
  | 'external'
  | 'logout'
  | 'notification'
  | 'sound';

function UiIcon({ name }: { name: UiIconName }) {
  const paths: Record<UiIconName, ReactNode> = {
    agents: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    statistics: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19V3" />
      </>
    ),
    workspace: (
      <>
        <path d="M4 13a8 8 0 0 1 16 0" />
        <path d="M18 19c0 1.1-.9 2-2 2h-3" />
        <path d="M4 13v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2Z" />
        <path d="M20 13v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z" />
      </>
    ),
    external: (
      <>
        <path d="M15 3h6v6" />
        <path d="m10 14 11-11" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      </>
    ),
    notification: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    sound: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </>
    ),
  };

  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

type AgentDraft = {
  id: string | null;
  name: string;
  username: string;
  password: string;
  routingScope: AgentRoutingScope;
  maxActiveConversations: number;
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
  username: '',
  password: '',
  routingScope: { type: 'none' },
  maxActiveConversations: 0,
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

function emitAgentMessageTone(context: AudioContext): void {
  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.11, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  gain.connect(context.destination);

  for (const [frequency, offset] of [
    [660, 0],
    [880, 0.075],
  ] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now + offset);
    oscillator.connect(gain);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + 0.13);
  }
}

type InboxRealtimeEvent = {
  type?: string;
  conversation?: Conversation;
  overview?: Overview | null;
};

type ThreadRealtimeEvent = {
  type?: string;
  message?: Message;
  media?: Omit<AgentMediaItem, 'url'>;
  reader?: 'agent' | 'visitor';
  lastMessageId?: string | null;
  status?: Conversation['status'];
  assignment?: { id: string; name: string } | null;
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

function AdminLogin({
  password,
  error,
  onChange,
  onSubmit,
}: {
  password: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <AuthPage
      eyebrow="MANAGEMENT"
      title="登录客服管理中心"
      description="管理员负责客服账号和产品接待范围配置。"
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          管理员密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-button" disabled={!password}>
          登录管理中心
        </button>
        <a className="auth-link" href="/agent">
          我是客服，进入客服登录
        </a>
      </form>
    </AuthPage>
  );
}

function AgentLogin({
  username,
  password,
  error,
  onUsername,
  onPassword,
  onSubmit,
}: {
  username: string;
  password: string;
  error: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <AuthPage
      eyebrow="AGENT WORKSPACE"
      title="客服登录"
      description="所有客服使用同一个入口，登录后只进入自己的会话工作台。"
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          客服账号
          <input
            value={username}
            onChange={(event) => onUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          登录密码
          <input
            type="password"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button
          className="primary-button"
          disabled={!username.trim() || !password}
        >
          进入工作台
        </button>
        <a className="auth-link" href="/">
          返回管理中心
        </a>
      </form>
    </AuthPage>
  );
}

function AuthPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-mark">CS</div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
      </div>
    </div>
  );
}

function AdminSetup() {
  return (
    <AuthPage
      eyebrow="SETUP"
      title="管理中心需要初始化"
      description="在 Cloudflare Worker 中配置 ADMIN_PASSWORD Secret 后即可登录管理中心。"
    >
      <a className="auth-link" href="/agent">
        客服登录入口
      </a>
    </AuthPage>
  );
}

function Startup({ label }: { label: string }) {
  return (
    <div className="startup">
      <div className="auth-mark">CS</div>
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ConversationExpiryCountdown({
  expiresAt,
}: {
  expiresAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const timestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(timestamp)) return null;
  const remaining = Math.max(0, timestamp - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const urgency =
    remaining <= 5 * 60 * 1000
      ? ' is-urgent'
      : remaining <= 60 * 60 * 1000
        ? ' is-warning'
        : '';

  return (
    <span className={`conversation-expiry${urgency}`} aria-live="off">
      <span aria-hidden="true">◷</span>
      {remaining > 0 ? `会话将在 ${clock} 后自动删除` : '会话已到期，正在删除'}
    </span>
  );
}

function Bubble({
  message: item,
  media,
}: {
  message: Message;
  media: AgentMediaItem | null;
}) {
  if (item.sender_type === 'system')
    return <div className="system-message">{item.body}</div>;
  const isAgent = item.sender_type === 'agent';
  const isRead = Boolean(item.read_by_visitor_at);
  return (
    <div className={isAgent ? 'message mine' : 'message visitor'}>
      {!isAgent && <span className="avatar tiny">访</span>}
      <div>
        {media ? (
          <a href={media.url} target="_blank" rel="noreferrer">
            <img
              className="message-image"
              src={media.url}
              alt="聊天图片"
              loading="lazy"
            />
          </a>
        ) : (
          <p>{item.body}</p>
        )}
        <span className="message-meta">
          <time>{formatTime(item.created_at)}</time>
          {isAgent ? (
            <span
              className={`delivery-mark${isRead ? ' is-read' : ''}`}
              aria-label={isRead ? '已读' : '已发送'}
              title={isRead ? '已读' : '已发送'}
            >
              {isRead ? '✓✓' : '✓'}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
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
};

export {
  UiIcon,
  emptyAgentDraft,
  filterLabels,
  CHAT_TIME_ZONE,
  AGENT_TYPING_IDLE_MS,
  REMOTE_TYPING_STALE_MS,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
  loadAgentSoundEnabled,
  saveAgentSoundEnabled,
  emitAgentMessageTone,
  parseRealtimeEvent,
  sortedConversationList,
  compareMessages,
  productsForScope,
  agentScopeSummary,
  AdminLogin,
  AgentLogin,
  AdminSetup,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  formatTime,
  message,
};
