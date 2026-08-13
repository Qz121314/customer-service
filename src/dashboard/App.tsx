import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AgentAccount,
  AgentIdentity,
  Conversation,
  ConversationDetail,
  Message,
  SupportGroup,
  adminLogin,
  adminLogout,
  agentLogin,
  agentLogout,
  createAgent,
  createGroup,
  getAdminSession,
  getAgentSession,
  getAgents,
  getConversation,
  getConversations,
  getGroups,
  getOverview,
  heartbeat,
  openAgentInboxSocket,
  openConversationSocket,
  sendMessage,
  setConversationStatus,
  updateAgent,
  updateGroup,
} from './api';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];

type AgentDraft = {
  id: string | null;
  name: string;
  username: string;
  password: string;
  groupIds: string[];
  maxActiveConversations: number;
  isEnabled: boolean;
};

const emptyAgentDraft: AgentDraft = {
  id: null,
  name: '',
  username: '',
  password: '',
  groupIds: [],
  maxActiveConversations: 0,
  isEnabled: true,
};

const filterLabels: Record<Filter, string> = {
  all: '全部',
  open: '新会话',
  pending: '处理中',
  closed: '已关闭',
};

export function App() {
  return window.location.pathname.startsWith('/agent') ? (
    <AgentPortal />
  ) : (
    <AdminPortal />
  );
}

function AdminPortal() {
  const [state, setState] = useState<LoadState>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAdminSession()
      .then((session) => {
        if (!session.configured) setState('not-configured');
        else setState(session.authenticated ? 'authenticated' : 'signed-out');
      })
      .catch(() => setState('signed-out'));
  }, []);

  if (state === 'loading') return <Startup label="正在加载管理中心…" />;
  if (state === 'not-configured') return <AdminSetup />;
  if (state === 'signed-out') {
    return (
      <AdminLogin
        password={password}
        error={error}
        onChange={setPassword}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            await adminLogin(password);
            setPassword('');
            setState('authenticated');
          } catch (reason) {
            setError(message(reason, '登录失败'));
          }
        }}
      />
    );
  }

  return (
    <AdminCenter
      onLogout={async () => {
        await adminLogout();
        setState('signed-out');
      }}
    />
  );
}

function AdminCenter({ onLogout }: { onLogout: () => Promise<void> }) {
  const [agents, setAgents] = useState<AgentAccount[]>([]);
  const [groups, setGroups] = useState<SupportGroup[]>([]);
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextAgents, nextGroups] = await Promise.all([getAgents(), getGroups()]);
    setAgents(nextAgents);
    setGroups(nextGroups);
  }, []);

  useEffect(() => {
    refresh()
      .catch((reason) => setError(message(reason, '无法加载配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  function editAgent(agent: AgentAccount) {
    setDraft({
      id: agent.id,
      name: agent.name,
      username: agent.username ?? '',
      password: '',
      groupIds: agent.groupIds,
      maxActiveConversations: agent.maxActiveConversations,
      isEnabled: agent.isEnabled,
    });
  }

  async function saveAgent(event: FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.username.trim()) return;
    if (!draft.id && draft.password.length < 4) {
      setError('新客服必须设置至少 4 个字符的登录密码。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (draft.id) {
        await updateAgent(draft.id, {
          name: draft.name,
          username: draft.username,
          password: draft.password || undefined,
          groupIds: draft.groupIds,
          maxActiveConversations: draft.maxActiveConversations,
          isEnabled: draft.isEnabled,
        });
      } else {
        await createAgent({
          name: draft.name,
          username: draft.username,
          password: draft.password,
          groupIds: draft.groupIds,
          maxActiveConversations: draft.maxActiveConversations,
          isEnabled: draft.isEnabled,
        });
      }
      setDraft(emptyAgentDraft);
      await refresh();
    } catch (reason) {
      setError(message(reason, '保存客服失败'));
    } finally {
      setSaving(false);
    }
  }

  async function addGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupName.trim()) return;
    setSaving(true);
    setError('');
    try {
      await createGroup(groupName.trim());
      setGroupName('');
      await refresh();
    } catch (reason) {
      setError(message(reason, '创建分组失败'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">CUSTOMER SERVICE</span>
          <h1>客服管理中心</h1>
          <p>这里只配置客服账号、客服分组和分流关系，不处理访客聊天。</p>
        </div>
        <div className="topbar-actions">
          <a className="secondary-button" href="/agent">
            客服登录入口
          </a>
          <button className="ghost-button" onClick={() => void onLogout()}>
            退出管理
          </button>
        </div>
      </header>

      {error && (
        <button className="notice error" onClick={() => setError('')}>
          {error}
        </button>
      )}

      <main className="admin-grid">
        <section className="panel agents-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">SEATS</span>
              <h2>客服账号</h2>
            </div>
            <button className="primary-button" onClick={() => setDraft(emptyAgentDraft)}>
              新增客服
            </button>
          </div>

          {busy ? (
            <div className="empty-state">正在加载客服账号…</div>
          ) : agents.length === 0 ? (
            <div className="empty-state">
              <strong>还没有客服账号</strong>
              <span>先创建客服账号，再将账号加入对应客服分组。</span>
            </div>
          ) : (
            <div className="agent-list">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className={draft.id === agent.id ? 'agent-row selected' : 'agent-row'}
                  onClick={() => editAgent(agent)}
                >
                  <span className={`presence ${presenceClass(agent)}`} />
                  <span className="agent-main">
                    <strong>{agent.name}</strong>
                    <small>@{agent.username || '未设置账号'}</small>
                  </span>
                  <span className="agent-groups">
                    {agent.groupIds.length
                      ? agent.groupIds
                          .map((id) => groupById.get(id)?.name || '未知分组')
                          .join(' · ')
                      : '未加入分组'}
                  </span>
                  <span className="status-label">
                    {agent.isEnabled ? statusLabel(agent.status) : '已停用'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel editor-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">ACCOUNT</span>
              <h2>{draft.id ? '编辑客服' : '新增客服'}</h2>
            </div>
          </div>

          <form className="form-stack" onSubmit={(event) => void saveAgent(event)}>
            <label>
              显示名称
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：Alice"
              />
            </label>
            <label>
              登录账号
              <input
                value={draft.username}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                placeholder="例如：alice"
                autoComplete="off"
              />
            </label>
            <label>
              {draft.id ? '重置密码（留空则不修改）' : '登录密码'}
              <input
                type="password"
                value={draft.password}
                onChange={(event) => setDraft({ ...draft, password: event.target.value })}
                autoComplete="new-password"
              />
            </label>
            <label>
              最大同时会话数
              <input
                type="number"
                min="0"
                max="999"
                value={draft.maxActiveConversations}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    maxActiveConversations: Number(event.target.value) || 0,
                  })
                }
              />
              <small>0 表示不限制。</small>
            </label>

            <fieldset>
              <legend>所属客服分组</legend>
              <div className="check-grid">
                {groups.filter((group) => group.isEnabled).map((group) => (
                  <label className="check-card" key={group.id}>
                    <input
                      type="checkbox"
                      checked={draft.groupIds.includes(group.id)}
                      onChange={(event) => {
                        const groupIds = event.target.checked
                          ? [...draft.groupIds, group.id]
                          : draft.groupIds.filter((id) => id !== group.id);
                        setDraft({ ...draft, groupIds });
                      }}
                    />
                    <span>{group.name}</span>
                  </label>
                ))}
                {groups.filter((group) => group.isEnabled).length === 0 && (
                  <span className="muted">请先创建并启用客服分组。</span>
                )}
              </div>
            </fieldset>

            <label className="switch-line">
              <input
                type="checkbox"
                checked={draft.isEnabled}
                onChange={(event) => setDraft({ ...draft, isEnabled: event.target.checked })}
              />
              <span>启用这个客服账号</span>
            </label>

            <div className="form-actions">
              {draft.id && (
                <button type="button" className="ghost-button" onClick={() => setDraft(emptyAgentDraft)}>
                  取消编辑
                </button>
              )}
              <button className="primary-button" disabled={saving || !draft.name || !draft.username}>
                {saving ? '保存中…' : draft.id ? '保存修改' : '创建客服'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel groups-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">ROUTING</span>
              <h2>客服分组</h2>
            </div>
          </div>

          <form className="inline-form" onSubmit={(event) => void addGroup(event)}>
            <input
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="新分组名称"
            />
            <button className="primary-button" disabled={!groupName.trim() || saving}>
              添加分组
            </button>
          </form>

          <div className="group-list">
            {groups.map((group) => (
              <div className="group-row" key={group.id}>
                <div>
                  <strong>{group.name}</strong>
                  <small>{group.agentIds.length} 个客服 · 最少进行中会话优先</small>
                </div>
                <label className="switch-line compact">
                  <input
                    type="checkbox"
                    checked={group.isEnabled}
                    onChange={async (event) => {
                      try {
                        await updateGroup(group.id, { isEnabled: event.target.checked });
                        await refresh();
                      } catch (reason) {
                        setError(message(reason, '更新分组失败'));
                      }
                    }}
                  />
                  <span>{group.isEnabled ? '启用' : '停用'}</span>
                </label>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function AgentPortal() {
  const [state, setState] = useState<LoadState>('loading');
  const [identity, setIdentity] = useState<AgentIdentity | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getAgentSession()
      .then((session) => {
        setIdentity(session.agent);
        setState(session.authenticated ? 'authenticated' : 'signed-out');
      })
      .catch(() => setState('signed-out'));
  }, []);

  if (state === 'loading') return <Startup label="正在加载客服工作台…" />;
  if (state === 'signed-out' || !identity) {
    return (
      <AgentLogin
        username={username}
        password={password}
        error={error}
        onUsername={setUsername}
        onPassword={setPassword}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            const agent = await agentLogin(username, password);
            setIdentity(agent);
            setPassword('');
            setState('authenticated');
          } catch (reason) {
            setError(message(reason, '登录失败'));
          }
        }}
      />
    );
  }

  return (
    <AgentWorkspace
      identity={identity}
      onLogout={async () => {
        await agentLogout();
        setIdentity(null);
        setState('signed-out');
      }}
    />
  );
}

function AgentWorkspace({
  identity,
  onLogout,
}: {
  identity: AgentIdentity;
  onLogout: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [overview, setOverview] = useState({ open: 0, pending: 0, closed: 0, total: 0 });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextOverview, nextConversations] = await Promise.all([
      getOverview(),
      getConversations(filter === 'all' ? undefined : filter),
    ]);
    setOverview(nextOverview);
    setConversations(nextConversations);
  }, [filter]);

  useEffect(() => {
    setBusy(true);
    refresh()
      .catch((reason) => setError(message(reason, '无法加载会话')))
      .finally(() => setBusy(false));
  }, [refresh]);

  useEffect(() => {
    void heartbeat().then(refresh).catch(() => undefined);
    const timer = window.setInterval(() => {
      void heartbeat().then(refresh).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    const connect = () => {
      if (!active) return;
      socket = openAgentInboxSocket();
      socket.addEventListener('message', () => {
        if (active) void refresh();
      });
      socket.addEventListener('close', () => {
        if (active) timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    const load = () =>
      getConversation(selectedId)
        .then((value) => {
          if (active) setDetail(value);
        })
        .catch((reason) => {
          if (active) setError(message(reason, '无法加载会话'));
        });
    void load();
    const socket = openConversationSocket(selectedId);
    socket.addEventListener('message', () => {
      if (active) {
        void load();
        void refresh();
      }
    });
    socket.addEventListener('error', () => socket.close());
    return () => {
      active = false;
      socket.close();
    };
  }, [refresh, selectedId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim()) return;
    const text = draft.trim();
    setDraft('');
    try {
      await sendMessage(selectedId, text);
      setDetail(await getConversation(selectedId));
      await refresh();
    } catch (reason) {
      setDraft(text);
      setError(message(reason, '发送失败'));
    }
  }

  async function changeStatus(status: Conversation['status']) {
    if (!selectedId) return;
    try {
      await setConversationStatus(selectedId, status);
      setDetail(await getConversation(selectedId));
      await refresh();
    } catch (reason) {
      setError(message(reason, '更新会话状态失败'));
    }
  }

  return (
    <div className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">CS</div>
        <div className="agent-profile">
          <span className="avatar">{initials(identity.name)}</span>
          <div>
            <strong>{identity.name}</strong>
            <small>@{identity.username}</small>
          </div>
          <i className="presence online" />
        </div>
        <div className="workspace-metrics">
          <Metric label="处理中" value={overview.pending} />
          <Metric label="新会话" value={overview.open} />
          <Metric label="已关闭" value={overview.closed} />
        </div>
        <button className="ghost-button full" onClick={() => void onLogout()}>
          退出客服账号
        </button>
      </aside>

      <section className="conversation-pane">
        <header className="conversation-head">
          <div>
            <span className="eyebrow">MY INBOX</span>
            <h1>我的会话</h1>
          </div>
          <span className="online-pill">在线接待</span>
        </header>
        <div className="filters">
          {(Object.keys(filterLabels) as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? 'filter active' : 'filter'}
              onClick={() => setFilter(item)}
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
        <div className="conversation-list">
          {busy ? (
            <div className="empty-state">正在加载…</div>
          ) : conversations.length === 0 ? (
            <div className="empty-state">
              <strong>当前没有分配给你的会话</strong>
              <span>保持此页面在线，系统会按客服分组和负载自动分流。</span>
            </div>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === selectedId ? 'conversation-row selected' : 'conversation-row'}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="avatar small">{initials(conversation.visitor_name || '访客')}</span>
                <span className="conversation-copy">
                  <span>
                    <strong>{conversation.visitor_name || '访客'}</strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>
                  </span>
                  <small>{conversation.product_title || conversation.subject || '访客咨询'}</small>
                  <p>{conversation.last_message || '会话已创建'}</p>
                </span>
              </button>
            ))
          )}
        </div>
      </section>

      <main className="thread-pane">
        {error && (
          <button className="notice error floating" onClick={() => setError('')}>
            {error}
          </button>
        )}
        {!selectedId ? (
          <div className="thread-empty">
            <strong>选择一个会话</strong>
            <span>这里只显示系统已经分配给当前客服账号的会话。</span>
          </div>
        ) : !detail ? (
          <div className="thread-empty">正在加载会话…</div>
        ) : (
          <>
            <header className="thread-head">
              <div>
                <span className="eyebrow">VISITOR</span>
                <h2>{String(detail.conversation.visitor_name || '访客')}</h2>
                <p>{String(detail.conversation.product_title || detail.conversation.subject || '访客咨询')}</p>
              </div>
              <select
                value={String(detail.conversation.status)}
                onChange={(event) => void changeStatus(event.target.value as Conversation['status'])}
                aria-label="会话状态"
              >
                <option value="open">新会话</option>
                <option value="pending">处理中</option>
                <option value="closed">已关闭</option>
              </select>
            </header>
            <div className="messages">
              {(detail.messages as Message[]).map((item) => (
                <Bubble key={item.id} message={item} currentAgentId={identity.id} />
              ))}
            </div>
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <textarea
                value={draft}
                rows={3}
                disabled={detail.conversation.status === 'closed'}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={detail.conversation.status === 'closed' ? '会话已关闭' : '输入回复内容…'}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-foot">
                <span>Enter 发送 · Shift + Enter 换行</span>
                <button className="primary-button" disabled={!draft.trim() || detail.conversation.status === 'closed'}>
                  发送
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
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
    <AuthPage eyebrow="MANAGEMENT" title="登录客服管理中心" description="管理员只负责客服账号、分组和分流配置。">
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
        <button className="primary-button" disabled={!password}>登录管理中心</button>
        <a className="auth-link" href="/agent">我是客服，进入客服登录</a>
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
    <AuthPage eyebrow="AGENT WORKSPACE" title="客服登录" description="所有客服使用同一个入口，登录后只进入自己的会话工作台。">
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
        <button className="primary-button" disabled={!username.trim() || !password}>进入工作台</button>
        <a className="auth-link" href="/">返回管理中心</a>
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
  children: React.ReactNode;
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
    <AuthPage eyebrow="SETUP" title="管理中心需要初始化" description="在 Cloudflare Worker 中配置 ADMIN_PASSWORD Secret 后即可登录管理中心。">
      <a className="auth-link" href="/agent">客服登录入口</a>
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Bubble({ message: item, currentAgentId }: { message: Message; currentAgentId: string }) {
  if (item.sender_type === 'system') return <div className="system-message">{item.body}</div>;
  const mine = item.sender_type === 'agent' && item.sender_id === currentAgentId;
  return (
    <div className={mine ? 'message mine' : 'message visitor'}>
      {!mine && <span className="avatar tiny">访</span>}
      <div>
        <p>{item.body}</p>
        <time>{formatTime(item.created_at)}</time>
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
  return new Date(value).toLocaleDateString('zh-CN');
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
