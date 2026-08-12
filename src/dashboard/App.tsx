import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Conversation,
  ConversationDetail,
  Message,
  Overview,
  getConversation,
  getConversations,
  getOverview,
  getSession,
  login,
  logout,
  openConversationSocket,
  sendMessage,
  setConversationStatus,
} from './api';

type AuthState = 'loading' | 'authenticated' | 'signed-out' | 'not-configured';
type Filter = 'all' | Conversation['status'];

const emptyOverview: Overview = {
  open: 0,
  pending: 0,
  closed: 0,
  visitors: 0,
  messages: 0,
};

const filterLabels: Record<Filter, string> = {
  all: '全部',
  open: '进行中',
  pending: '待处理',
  closed: '已关闭',
};

export function App() {
  const [auth, setAuth] = useState<AuthState>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getSession()
      .then((session) => {
        if (!session.configured) setAuth('not-configured');
        else setAuth(session.authenticated ? 'authenticated' : 'signed-out');
      })
      .catch(() => setAuth('signed-out'));
  }, []);

  if (auth === 'loading') return <Startup />;
  if (auth === 'not-configured') return <Setup />;
  if (auth === 'signed-out') {
    return (
      <Login
        password={password}
        error={error}
        onChange={setPassword}
        onSubmit={async (event) => {
          event.preventDefault();
          setError('');
          try {
            await login(password);
            setPassword('');
            setAuth('authenticated');
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : '登录失败');
          }
        }}
      />
    );
  }

  return (
    <Workspace
      onLogout={async () => {
        await logout();
        setAuth('signed-out');
      }}
    />
  );
}

function Workspace({ onLogout }: { onLogout: () => Promise<void> }) {
  const [overview, setOverview] = useState<Overview>(emptyOverview);
  const [filter, setFilter] = useState<Filter>('all');
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
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : '无法加载会话列表'),
      )
      .finally(() => setBusy(false));
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    let active = true;
    getConversation(selectedId)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : '无法加载会话');
      });

    const socket = openConversationSocket(selectedId);
    socket.addEventListener('message', (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(String(event.data)) as
          | { type: 'message'; message: Message }
          | { type: 'conversation.status'; status: Conversation['status'] }
          | { type: 'ready' };

        if (payload.type === 'message') {
          setDetail((current) => {
            if (
              !current ||
              current.messages.some((item) => item.id === payload.message.id)
            ) {
              return current;
            }
            return {
              ...current,
              messages: [...current.messages, payload.message],
            };
          });
          void refresh();
        }

        if (payload.type === 'conversation.status') {
          setDetail((current) =>
            current
              ? {
                  ...current,
                  conversation: {
                    ...current.conversation,
                    status: payload.status,
                  },
                }
              : current,
          );
          void refresh();
        }
      } catch {
        // 忽略非 JSON WebSocket 帧。
      }
    });

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
      const message = await sendMessage(selectedId, text);
      setDetail((current) => {
        if (!current || current.messages.some((item) => item.id === message.id))
          return current;
        return { ...current, messages: [...current.messages, message] };
      });
      await refresh();
    } catch (reason) {
      setDraft(text);
      setError(reason instanceof Error ? reason.message : '消息发送失败');
    }
  }

  async function changeStatus(status: Conversation['status']) {
    if (!selectedId) return;
    try {
      await setConversationStatus(selectedId, status);
      setDetail((current) =>
        current
          ? { ...current, conversation: { ...current.conversation, status } }
          : current,
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '会话状态更新失败');
    }
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="logo">客</div>
        <button className="rail-item active" title="会话">
          ◫
        </button>
        <button className="rail-item" title="联系人" disabled>
          ◎
        </button>
        <button className="rail-item" title="设置" disabled>
          ⚙
        </button>
        <button
          className="avatar"
          onClick={() => void onLogout()}
          title="退出登录"
        >
          管
        </button>
      </aside>

      <section className="inbox">
        <header className="inbox-head">
          <div>
            <span className="eyebrow">客服工作台</span>
            <h1>会话</h1>
          </div>
          <span className="live">
            <i /> 实时
          </span>
        </header>

        <div className="metrics">
          <Metric label="进行中" value={overview.open} />
          <Metric label="待处理" value={overview.pending} />
          <Metric label="已关闭" value={overview.closed} />
        </div>

        <div className="filters">
          {(['all', 'open', 'pending', 'closed'] as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? 'filter active' : 'filter'}
              onClick={() => setFilter(item)}
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>

        <div className="list">
          {busy ? (
            <div className="loading-list">正在加载会话…</div>
          ) : conversations.length === 0 ? (
            <div className="empty-list">
              <strong>暂无会话</strong>
              <span>新的访客会话会显示在这里。</span>
            </div>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={
                  conversation.id === selectedId
                    ? 'conversation active'
                    : 'conversation'
                }
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="person">
                  {initials(conversation.visitor_name || '访客')}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-line">
                    <strong>{conversation.visitor_name || '访客'}</strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>
                  </span>
                  <span className="preview">
                    {conversation.last_message || '会话已创建'}
                  </span>
                </span>
                <i className={`dot ${conversation.status}`} />
              </button>
            ))
          )}
        </div>
      </section>

      <main className="thread">
        {error && (
          <button className="error" onClick={() => setError('')}>
            {error} <small>关闭</small>
          </button>
        )}

        {!selectedId ? (
          <div className="thread-empty">
            <div className="empty-symbol">↔</div>
            <h2>选择一个会话</h2>
            <p>选择左侧会话后，可查看消息并进行回复和状态管理。</p>
          </div>
        ) : !detail ? (
          <div className="thread-empty">
            <p>正在加载会话…</p>
          </div>
        ) : (
          <>
            <header className="thread-head">
              <button
                className="back"
                onClick={() => setSelectedId(null)}
                aria-label="返回"
              >
                ←
              </button>
              <span className="person large">
                {initials(String(detail.conversation.visitor_name || '访客'))}
              </span>
              <div className="identity">
                <h2>{String(detail.conversation.visitor_name || '访客')}</h2>
                <p>站点：{String(detail.conversation.site_id)}</p>
              </div>
              <select
                value={String(detail.conversation.status)}
                onChange={(event) =>
                  void changeStatus(
                    event.target.value as Conversation['status'],
                  )
                }
                aria-label="会话状态"
              >
                <option value="open">进行中</option>
                <option value="pending">待处理</option>
                <option value="closed">已关闭</option>
              </select>
            </header>

            <div className="messages">
              <div className="day">
                会话开始于 {formatDate(String(detail.conversation.created_at))}
              </div>
              {detail.messages.length === 0 ? (
                <div className="no-messages">暂无消息。</div>
              ) : (
                detail.messages.map((message) => (
                  <Bubble key={message.id} message={message} />
                ))
              )}
            </div>

            <form className="composer" onSubmit={(event) => void submit(event)}>
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="输入回复内容…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-foot">
                <button
                  className="attach"
                  type="button"
                  disabled
                  title="附件功能稍后开放"
                >
                  ＋
                </button>
                <span>Enter 发送 · Shift + Enter 换行</span>
                <button className="send" type="submit" disabled={!draft.trim()}>
                  发送 →
                </button>
              </div>
            </form>
          </>
        )}
      </main>
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

function Bubble({ message }: { message: Message }) {
  if (message.sender_type === 'system')
    return <div className="system">{message.body}</div>;
  const agent = message.sender_type === 'agent';
  return (
    <div className={agent ? 'message agent' : 'message visitor'}>
      {!agent && <span className="person mini">访</span>}
      <div>
        <p>{message.body}</p>
        <time>{formatTime(message.created_at)}</time>
      </div>
    </div>
  );
}

function Login({
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
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="logo auth-logo">客</div>
        <span className="eyebrow">客服管理系统</span>
        <h1>登录客服工作台</h1>
        <p>请输入当前部署配置的管理员密码。</p>
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
        <button className="primary" disabled={!password}>
          登录
        </button>
      </form>
    </div>
  );
}

function Setup() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo auth-logo">客</div>
        <span className="eyebrow">需要配置</span>
        <h1>客服服务已上线</h1>
        <p>
          请在 Cloudflare 的 <code>customer-service-app</code> Worker 中添加
          <code> ADMIN_PASSWORD</code> Secret，配置后即可登录。
        </p>
      </div>
    </div>
  );
}

function Startup() {
  return (
    <div className="startup">
      <div className="logo">客</div>
      <span>正在加载工作台…</span>
    </div>
  );
}

function initials(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '访';
  if (/^[\u3400-\u9fff]/.test(trimmed)) return trimmed.slice(0, 2);
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function parseUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function relativeTime(value: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - parseUtc(value).getTime()) / 1000),
  );
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

function formatTime(value: string): string {
  return parseUtc(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(value: string): string {
  return parseUtc(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
