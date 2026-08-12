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

const emptyOverview: Overview = { open: 0, pending: 0, closed: 0, visitors: 0, messages: 0 };

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
            setError(reason instanceof Error ? reason.message : 'Login failed');
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
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load inbox'))
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
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load conversation');
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
            if (!current || current.messages.some((item) => item.id === payload.message.id)) {
              return current;
            }
            return { ...current, messages: [...current.messages, payload.message] };
          });
          void refresh();
        }

        if (payload.type === 'conversation.status') {
          setDetail((current) =>
            current
              ? {
                  ...current,
                  conversation: { ...current.conversation, status: payload.status },
                }
              : current,
          );
          void refresh();
        }
      } catch {
        // Ignore non-JSON WebSocket frames.
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
        if (!current || current.messages.some((item) => item.id === message.id)) return current;
        return { ...current, messages: [...current.messages, message] };
      });
      await refresh();
    } catch (reason) {
      setDraft(text);
      setError(reason instanceof Error ? reason.message : 'Message could not be sent');
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
      setError(reason instanceof Error ? reason.message : 'Status could not be updated');
    }
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="logo">CS</div>
        <button className="rail-item active" title="Inbox">
          ◫
        </button>
        <button className="rail-item" title="Contacts" disabled>
          ◎
        </button>
        <button className="rail-item" title="Settings" disabled>
          ⚙
        </button>
        <button className="avatar" onClick={() => void onLogout()} title="Sign out">
          A
        </button>
      </aside>

      <section className="inbox">
        <header className="inbox-head">
          <div>
            <span className="eyebrow">Workspace</span>
            <h1>Inbox</h1>
          </div>
          <span className="live"><i /> Live</span>
        </header>

        <div className="metrics">
          <Metric label="Open" value={overview.open} />
          <Metric label="Pending" value={overview.pending} />
          <Metric label="Closed" value={overview.closed} />
        </div>

        <div className="filters">
          {(['all', 'open', 'pending', 'closed'] as Filter[]).map((item) => (
            <button
              key={item}
              className={filter === item ? 'filter active' : 'filter'}
              onClick={() => setFilter(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>

        <div className="list">
          {busy ? (
            <div className="loading-list">Loading conversations…</div>
          ) : conversations.length === 0 ? (
            <div className="empty-list">
              <strong>No conversations</strong>
              <span>New visitor conversations will appear here.</span>
            </div>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={conversation.id === selectedId ? 'conversation active' : 'conversation'}
                onClick={() => setSelectedId(conversation.id)}
              >
                <span className="person">{initials(conversation.visitor_name || 'Visitor')}</span>
                <span className="conversation-copy">
                  <span className="conversation-line">
                    <strong>{conversation.visitor_name || 'Visitor'}</strong>
                    <time>{relativeTime(conversation.last_message_at)}</time>
                  </span>
                  <span className="preview">{conversation.last_message || 'Conversation created'}</span>
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
            {error} <small>Dismiss</small>
          </button>
        )}

        {!selectedId ? (
          <div className="thread-empty">
            <div className="empty-symbol">↔</div>
            <h2>Select a conversation</h2>
            <p>Messages and conversation controls will appear here.</p>
          </div>
        ) : !detail ? (
          <div className="thread-empty"><p>Loading conversation…</p></div>
        ) : (
          <>
            <header className="thread-head">
              <button className="back" onClick={() => setSelectedId(null)} aria-label="Back">
                ←
              </button>
              <span className="person large">
                {initials(String(detail.conversation.visitor_name || 'Visitor'))}
              </span>
              <div className="identity">
                <h2>{String(detail.conversation.visitor_name || 'Visitor')}</h2>
                <p>Site: {String(detail.conversation.site_id)}</p>
              </div>
              <select
                value={String(detail.conversation.status)}
                onChange={(event) => void changeStatus(event.target.value as Conversation['status'])}
              >
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>
            </header>

            <div className="messages">
              <div className="day">Conversation started {formatDate(String(detail.conversation.created_at))}</div>
              {detail.messages.length === 0 ? (
                <div className="no-messages">No messages yet.</div>
              ) : (
                detail.messages.map((message) => <Bubble key={message.id} message={message} />)
              )}
            </div>

            <form className="composer" onSubmit={(event) => void submit(event)}>
              <textarea
                rows={3}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Write a reply…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-foot">
                <button className="attach" type="button" disabled title="Attachments are next">
                  ＋
                </button>
                <span>Enter to send · Shift + Enter for newline</span>
                <button className="send" type="submit" disabled={!draft.trim()}>
                  Send →
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
  return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;
}

function Bubble({ message }: { message: Message }) {
  if (message.sender_type === 'system') return <div className="system">{message.body}</div>;
  const agent = message.sender_type === 'agent';
  return (
    <div className={agent ? 'message agent' : 'message visitor'}>
      {!agent && <span className="person mini">V</span>}
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
        <div className="logo auth-logo">CS</div>
        <span className="eyebrow">Customer Service</span>
        <h1>Sign in to your workspace</h1>
        <p>Use the administrator password configured for this deployment.</p>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary" disabled={!password}>Continue</button>
      </form>
    </div>
  );
}

function Setup() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo auth-logo">CS</div>
        <span className="eyebrow">Setup required</span>
        <h1>Deployment is online</h1>
        <p>Add an <code>ADMIN_PASSWORD</code> repository secret and redeploy to enable login.</p>
      </div>
    </div>
  );
}

function Startup() {
  return <div className="startup"><div className="logo">CS</div><span>Loading workspace…</span></div>;
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function parseUtc(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - parseUtc(value).getTime()) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatTime(value: string): string {
  return parseUtc(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: string): string {
  return parseUtc(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
