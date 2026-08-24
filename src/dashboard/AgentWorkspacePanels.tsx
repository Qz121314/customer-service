import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentAvailability,
  AgentIdentity,
  AgentInbox,
  Conversation,
} from './api';
import { rememberAgentConversationHistory } from './agent-history';
import {
  clearAgentNotificationOpenIntent,
  hasAgentNotificationOpenIntent,
  isAgentNotificationOpenMessage,
  type AgentNotificationState,
} from './agent-push';
import type { Filter } from './dashboard-runtime';
import { filterLabels, initials, relativeTime } from './dashboard-runtime';
import { AgentAvatarControl } from './AgentAvatarControl';
import { AgentAutoReplySettingsModal } from './AgentAutoReplySettings';
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
  const [autoReplyOpen, setAutoReplyOpen] = useState(false);

  return (
    <>
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
          onOpenAutoReply={() => setAutoReplyOpen(true)}
          onOpenStatistics={onOpenStatistics}
          onLogout={onLogout}
        />
      </aside>
      <AgentAutoReplySettingsModal
        open={autoReplyOpen}
        onClose={() => setAutoReplyOpen(false)}
      />
    </>
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
  const [notificationOpenPending, setNotificationOpenPending] = useState(() =>
    hasAgentNotificationOpenIntent(),
  );
  const overviewRef = useRef(overview);
  const notificationOverviewBaselineRef = useRef(overview);
  const lastOverviewChangeAtRef = useRef(Date.now());
  const filterCounts: Record<Filter, number> = {
    all: conversationCount,
    open: overview.open,
    pending: overview.pending,
    closed: overview.closed,
  };

  useEffect(() => {
    overviewRef.current = overview;
    lastOverviewChangeAtRef.current = Date.now();
  }, [overview]);

  const selectConversation = useCallback(
    (conversationId: string) => {
      rememberAgentConversationHistory(conversationId, Boolean(selectedId));
      onSelectConversation(conversationId);
    },
    [onSelectConversation, selectedId],
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const openNotificationConversation = (event: MessageEvent) => {
      if (!isAgentNotificationOpenMessage(event.data)) return;
      notificationOverviewBaselineRef.current = overviewRef.current;
      setNotificationOpenPending(true);
    };
    navigator.serviceWorker.addEventListener(
      'message',
      openNotificationConversation,
    );
    return () =>
      navigator.serviceWorker.removeEventListener(
        'message',
        openNotificationConversation,
      );
  }, []);

  useEffect(() => {
    if (!notificationOpenPending || busy) return;
    const inboxFresh =
      overview !== notificationOverviewBaselineRef.current ||
      Date.now() - lastOverviewChangeAtRef.current <= 1500;
    if (!inboxFresh) return;

    let resetInboxView = false;
    if (filter !== 'all') {
      onFilterChange('all');
      resetInboxView = true;
    }
    if (searchQuery) {
      onSearchChange('');
      resetInboxView = true;
    }
    if (resetInboxView) return;

    const target = [...visibleConversations]
      .filter((conversation) => conversation.agent_unread_count > 0)
      .sort((left, right) => {
        const leftTime = Date.parse(left.last_message_at || left.created_at);
        const rightTime = Date.parse(right.last_message_at || right.created_at);
        return rightTime - leftTime;
      })[0];

    setNotificationOpenPending(false);
    clearAgentNotificationOpenIntent();
    if (target) selectConversation(target.id);
  }, [
    busy,
    filter,
    notificationOpenPending,
    onFilterChange,
    onSearchChange,
    overview,
    searchQuery,
    selectConversation,
    visibleConversations,
  ]);

  return (
    <section className="conversation-pane">
      <header className="conversation-head">
        <h1>
          会话
          {totalUnread > 0 && (
            <span className="unread-total">{totalUnread}</span>
          )}
        </h1>
        <div className="conversation-head-status">
          {overview.trafficQuotaEnabled && (
            <span
              className="availability-pill inbox-quota-pill"
              title="当前客服剩余接待额度"
            >
              额度 {overview.trafficQuotaRemaining}
            </span>
          )}
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
                ? '在线'
                : '暂停'}
          </button>
          <span
            className={`connection-status is-${connectionState}`}
            aria-live="polite"
          >
            <i aria-hidden="true" />
            {connectionState === 'connected'
              ? '实时'
              : connectionState === 'offline'
                ? '离线 · 草稿已保存'
                : connectionState === 'connecting'
                  ? '连接中'
                  : '恢复中'}
          </span>
        </div>
      </header>
      <div className="filters" aria-label="会话状态筛选">
        {(Object.keys(filterLabels) as Filter[]).map((item) => (
          <button
            type="button"
            key={item}
            className={filter === item ? 'filter active' : 'filter'}
            onClick={() => onFilterChange(item)}
          >
            {filterLabels[item]} {filterCounts[item]}
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
          未读置顶
        </button>
      </div>
      <div className="conversation-list">
        {busy ? (
          <div className="empty-state">正在加载…</div>
        ) : visibleConversations.length === 0 ? (
          <div className="empty-state">
            <strong>
              {conversationCount === 0 ? '暂无会话' : '没有匹配的会话'}
            </strong>
            {conversationCount === 0 && <span>保持在线，新会话会自动出现。</span>}
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
              onClick={() => selectConversation(conversation.id)}
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
                        {Math.min(conversation.agent_unread_count, 99)}
                      </span>
                    )}
                  </strong>
                  <time>{relativeTime(conversation.last_message_at)}</time>
                </span>
                <span className="conversation-meta-row">
                  <small>
                    {conversation.product_title ||
                      conversation.subject ||
                      '访客咨询'}
                  </small>
                  <span
                    className={`conversation-status is-${conversation.status}`}
                  >
                    {conversation.status === 'open'
                      ? '新'
                      : conversation.status === 'pending'
                        ? '处理中'
                        : '已关闭'}
                  </span>
                </span>
                <p>{conversation.last_message || '会话已创建'}</p>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
