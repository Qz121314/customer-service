import type {
  AgentAvailability,
  AgentIdentity,
  AgentInbox,
  Conversation,
} from './api';
import { rememberAgentConversationHistory } from './agent-history';
import type { AgentNotificationState } from './agent-push';
import type { Filter } from './dashboard-runtime';
import { filterLabels, initials, relativeTime } from './dashboard-runtime';
import { Metric } from './dashboard-ui';
import { AgentAvatarControl } from './AgentAvatarControl';
import { AgentActionToolbar } from './AgentWorkspaceChrome';

export function AgentSidebar({
  identity,
  availability,
  notificationState,
  notificationBusy,
  soundEnabled,
  onToggleNotifications,
  onToggleSound,
  onOpenStatistics,
  onLogout,
}: {
  identity: AgentIdentity;
  availability: AgentAvailability;
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="workspace-sidebar">
      <div className="workspace-brand-lockup">
        <div className="workspace-brand">CS</div>
        <span>坐席中心</span>
      </div>
      <div className="agent-profile">
        <AgentAvatarControl agentId={identity.id} agentName={identity.name} />
        <div>
          <strong>{identity.name}</strong>
          <small>@{identity.username}</small>
        </div>
        <i className={`presence ${availability}`} />
      </div>
      <AgentActionToolbar
        notificationState={notificationState}
        notificationBusy={notificationBusy}
        soundEnabled={soundEnabled}
        onToggleNotifications={onToggleNotifications}
        onToggleSound={onToggleSound}
        onOpenStatistics={onOpenStatistics}
        onLogout={onLogout}
      />
    </aside>
  );
}

export function AgentInboxPane({
  filter,
  searchQuery,
  unreadFirst,
  availability,
  availabilitySaving,
  networkOnline,
  inboxConnected,
  connectionState,
  totalUnread,
  overview,
  busy,
  visibleConversations,
  conversationCount,
  selectedId,
  onFilterChange,
  onSearchChange,
  onToggleUnreadFirst,
  onToggleAvailability,
  onSelectConversation,
}: {
  filter: Filter;
  searchQuery: string;
  unreadFirst: boolean;
  availability: AgentAvailability;
  availabilitySaving: boolean;
  networkOnline: boolean;
  inboxConnected: boolean;
  connectionState: 'offline' | 'connected' | 'connecting' | 'reconnecting';
  totalUnread: number;
  overview: AgentInbox['overview'];
  busy: boolean;
  visibleConversations: Conversation[];
  conversationCount: number;
  selectedId: string | null;
  onFilterChange: (filter: Filter) => void;
  onSearchChange: (value: string) => void;
  onToggleUnreadFirst: () => void;
  onToggleAvailability: () => void;
  onSelectConversation: (id: string) => void;
}) {
  return (
    <section className="conversation-pane">
      <header className="conversation-head">
        <div>
          <span className="eyebrow">坐席收件箱</span>
          <h1>
            我的会话
            {totalUnread > 0 && (
              <span className="unread-total">{totalUnread}</span>
            )}
          </h1>
        </div>
        <div className="conversation-head-status">
          <button
            type="button"
            className={`availability-pill is-${availability}`}
            aria-pressed={availability === 'busy'}
            disabled={availabilitySaving || !networkOnline || !inboxConnected}
            title={
              availability === 'online'
                ? '点击暂停接收新会话'
                : '点击恢复接收新会话'
            }
            onClick={onToggleAvailability}
          >
            <span aria-hidden="true" />
            {availabilitySaving
              ? '切换中…'
              : availability === 'online'
                ? '在线接待'
                : '暂停接待'}
          </button>
          <span
            className={`connection-status is-${connectionState}`}
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {connectionState === 'connected'
              ? '实时连接正常'
              : connectionState === 'offline'
                ? '网络已断开 · 草稿已保存'
                : connectionState === 'connecting'
                  ? '正在建立连接'
                  : '连接中断 · 正在恢复'}
          </span>
        </div>
      </header>
      <div className="inbox-overview" aria-label="会话概览">
        <Metric label="新会话" value={overview.open} />
        <Metric label="处理中" value={overview.pending} />
        <Metric label="已关闭" value={overview.closed} />
        <Metric
          label="剩余额度"
          value={
            overview.trafficQuotaEnabled
              ? overview.trafficQuotaRemaining
              : '不限'
          }
        />
      </div>
      <div className="filters">
        {(Object.keys(filterLabels) as Filter[]).map((item) => (
          <button
            type="button"
            key={item}
            className={filter === item ? 'filter active' : 'filter'}
            onClick={() => onFilterChange(item)}
          >
            {filterLabels[item]}
          </button>
        ))}
      </div>
      <div className="inbox-tools">
        <label className="inbox-search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            type="search"
            value={searchQuery}
            placeholder="搜索访客、产品或消息"
            aria-label="搜索会话"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={`unread-first-toggle${unreadFirst ? ' is-active' : ''}`}
          aria-pressed={unreadFirst}
          onClick={onToggleUnreadFirst}
        >
          未读优先
        </button>
      </div>
      <div className="conversation-list">
        {busy ? (
          <div className="empty-state">正在加载…</div>
        ) : visibleConversations.length === 0 ? (
          <div className="empty-state">
            <strong>
              {conversationCount === 0
                ? '当前没有分配给你的会话'
                : '没有找到匹配的会话'}
            </strong>
            {conversationCount === 0 && (
              <span>
                保持在线，负责产品的新会话会在对应在线客服之间自动轮询。
              </span>
            )}
          </div>
        ) : (
          visibleConversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={[
                'conversation-row',
                conversation.id === selectedId ? 'selected' : '',
                conversation.agent_unread_count > 0 ? 'unread' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-conversation-id={conversation.id}
              onClick={() => {
                rememberAgentConversationHistory(
                  conversation.id,
                  Boolean(selectedId),
                );
                onSelectConversation(conversation.id);
              }}
            >
              <span className="avatar small">
                {initials(conversation.visitor_name || '访客')}
              </span>
              <span className="conversation-copy">
                <span>
                  <strong>
                    {conversation.visitor_name || '访客'}
                    {conversation.agent_unread_count > 0 && (
                      <span className="unread-badge">
                        {conversation.status === 'open'
                          ? `新 · ${Math.min(conversation.agent_unread_count, 99)}`
                          : Math.min(conversation.agent_unread_count, 99)}
                      </span>
                    )}
                  </strong>
                  <time>{relativeTime(conversation.last_message_at)}</time>
                </span>
                <small>
                  {conversation.product_title ||
                    conversation.subject ||
                    '访客咨询'}
                </small>
                <p>{conversation.last_message || '会话已创建'}</p>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
