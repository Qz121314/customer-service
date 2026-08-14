import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  markConversationRead,
  openAgentInboxSocket,
  openConversationSocket,
  sendMessage,
  setConversationStatus,
  updateAgent,
  updateGroup,
} from './api';
import {
  getAgentMedia,
  sendAgentImage,
  type AgentMediaItem,
} from './agent-media';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];
type AdminSection = 'agents' | 'groups' | 'workspace';

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

const CHAT_TIME_ZONE = 'America/Los_Angeles';

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
  const [section, setSection] = useState<AdminSection>('agents');
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const [nextAgents, nextGroups] = await Promise.all([
      getAgents(),
      getGroups(),
    ]);
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
  const workspaceUrl = `${window.location.origin}/agent`;
  const onlineCount = agents.filter(
    (agent) => agent.isEnabled && agent.status === 'online',
  ).length;
  const enabledCount = agents.filter((agent) => agent.isEnabled).length;

  function createNewAgent() {
    setDraft(emptyAgentDraft);
    setEditorOpen(true);
    setError('');
  }

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
    setEditorOpen(true);
    setError('');
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
      setEditorOpen(false);
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

  async function copyWorkspaceUrl() {
    try {
      await navigator.clipboard.writeText(workspaceUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('无法复制链接，请手动复制。');
    }
  }

  const sectionTitle =
    section === 'agents'
      ? '客服账号'
      : section === 'groups'
        ? '客服分组'
        : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '管理员在这里创建员工账号、设置所属分组和接待容量。'
      : section === 'groups'
        ? '按业务场景组织客服，Site 只需要绑定这里的客服分组。'
        : '员工统一使用这个地址登录聊天工作台，管理后台本身不处理访客会话。';

  return (
    <div className="admin-console">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span>CS</span>
          <div>
            <strong>客服管理</strong>
            <small>管理员后台</small>
          </div>
        </div>
        <nav className="admin-nav" aria-label="客服管理导航">
          <button
            className={section === 'agents' ? 'active' : ''}
            onClick={() => setSection('agents')}
          >
            <span>客服账号</span>
            <small>{agents.length}</small>
          </button>
          <button
            className={section === 'groups' ? 'active' : ''}
            onClick={() => setSection('groups')}
          >
            <span>客服分组</span>
            <small>{groups.length}</small>
          </button>
          <button
            className={section === 'workspace' ? 'active' : ''}
            onClick={() => setSection('workspace')}
          >
            <span>坐席工作台</span>
            <small>员工入口</small>
          </button>
        </nav>
        <div className="admin-sidebar-foot">
          <a href="/agent" target="_blank" rel="noreferrer">
            打开坐席工作台<span>↗</span>
          </a>
          <button onClick={() => void onLogout()}>退出管理</button>
        </div>
      </aside>

      <main className="admin-content">
        <header className="admin-content-head">
          <div>
            <h1>{sectionTitle}</h1>
            <p>{sectionHint}</p>
          </div>
          {section === 'agents' && (
            <button className="primary-button" onClick={createNewAgent}>
              新增客服
            </button>
          )}
        </header>

        {error && (
          <button className="notice error" onClick={() => setError('')}>
            {error}
          </button>
        )}

        {section === 'agents' && (
          <>
            <section className="admin-stats">
              <div>
                <span>客服总数</span>
                <strong>{agents.length}</strong>
              </div>
              <div>
                <span>当前在线</span>
                <strong>{onlineCount}</strong>
              </div>
              <div>
                <span>已启用账号</span>
                <strong>{enabledCount}</strong>
              </div>
              <div>
                <span>客服分组</span>
                <strong>{groups.length}</strong>
              </div>
            </section>
            <section className="admin-table-card">
              <div className="admin-table-title">
                <div>
                  <strong>客服账号列表</strong>
                  <span>员工使用各自账号登录坐席工作台</span>
                </div>
              </div>
              {busy ? (
                <div className="empty-state">正在加载客服账号…</div>
              ) : agents.length === 0 ? (
                <div className="empty-state admin-empty">
                  <strong>还没有客服账号</strong>
                  <span>创建第一个客服账号后，再按需要加入客服分组。</span>
                  <button className="primary-button" onClick={createNewAgent}>
                    新增客服
                  </button>
                </div>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>客服</th>
                        <th>登录账号</th>
                        <th>所属分组</th>
                        <th>状态</th>
                        <th>最大会话</th>
                        <th>最后在线</th>
                        <th aria-label="操作" />
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((agent) => (
                        <tr key={agent.id}>
                          <td>
                            <div className="admin-agent-cell">
                              <span
                                className={`presence ${presenceClass(agent)}`}
                              />
                              <strong>{agent.name}</strong>
                            </div>
                          </td>
                          <td>{agent.username || '—'}</td>
                          <td>
                            <div className="group-tags">
                              {agent.groupIds.length ? (
                                agent.groupIds.map((id) => (
                                  <span key={id}>
                                    {groupById.get(id)?.name || '未知分组'}
                                  </span>
                                ))
                              ) : (
                                <em>未分组</em>
                              )}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`account-status ${presenceClass(agent)}`}
                            >
                              {agent.isEnabled
                                ? statusLabel(agent.status)
                                : '已停用'}
                            </span>
                          </td>
                          <td>{agent.maxActiveConversations || '不限'}</td>
                          <td>
                            {agent.lastSeenAt
                              ? relativeTime(agent.lastSeenAt)
                              : '从未登录'}
                          </td>
                          <td>
                            <button
                              className="table-action"
                              onClick={() => editAgent(agent)}
                            >
                              编辑
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {section === 'groups' && (
          <section className="admin-table-card">
            <div className="admin-table-title groups-title">
              <div>
                <strong>客服分组</strong>
                <span>分组负责承接 Site 绑定，并由系统分流给在线客服。</span>
              </div>
              <form
                className="group-create"
                onSubmit={(event) => void addGroup(event)}
              >
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder="输入分组名称"
                />
                <button
                  className="primary-button"
                  disabled={!groupName.trim() || saving}
                >
                  新增分组
                </button>
              </form>
            </div>
            {groups.length === 0 ? (
              <div className="empty-state">
                <strong>还没有客服分组</strong>
                <span>先创建分组，再把客服账号加入对应分组。</span>
              </div>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>分组名称</th>
                      <th>客服人数</th>
                      <th>分流方式</th>
                      <th>状态</th>
                      <th aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td>
                          <strong>{group.name}</strong>
                        </td>
                        <td>{group.agentIds.length}</td>
                        <td>最少进行中会话优先</td>
                        <td>
                          <span
                            className={`account-status ${group.isEnabled ? 'online' : 'offline'}`}
                          >
                            {group.isEnabled ? '已启用' : '已停用'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="table-action"
                            onClick={async () => {
                              try {
                                await updateGroup(group.id, {
                                  isEnabled: !group.isEnabled,
                                });
                                await refresh();
                              } catch (reason) {
                                setError(message(reason, '更新分组失败'));
                              }
                            }}
                          >
                            {group.isEnabled ? '停用' : '启用'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {section === 'workspace' && (
          <section className="workspace-access-card">
            <div className="workspace-access-icon">CS</div>
            <div className="workspace-access-copy">
              <span>员工统一入口</span>
              <h2>客服坐席工作台</h2>
              <p>
                所有客服员工访问同一个地址，再使用管理员创建的登录账号和密码进入自己的聊天工作台。
              </p>
              <div className="workspace-url-row">
                <code>{workspaceUrl}</code>
                <button
                  className="secondary-button"
                  onClick={() => void copyWorkspaceUrl()}
                >
                  {copied ? '已复制' : '复制链接'}
                </button>
                <a
                  className="primary-button"
                  href="/agent"
                  target="_blank"
                  rel="noreferrer"
                >
                  打开工作台
                </a>
              </div>
            </div>
          </section>
        )}
      </main>

      {editorOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !saving && setEditorOpen(false)}
        >
          <section
            className="agent-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2>{draft.id ? '编辑客服账号' : '新增客服账号'}</h2>
                <p>账号只用于员工登录坐席工作台。</p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="关闭"
                onClick={() => !saving && setEditorOpen(false)}
              >
                ×
              </button>
            </header>
            <form
              className="agent-editor-form"
              onSubmit={(event) => void saveAgent(event)}
            >
              <div className="form-two-columns">
                <label>
                  <span>显示名称</span>
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    placeholder="例如 Amy"
                    autoFocus
                  />
                </label>
                <label>
                  <span>登录账号</span>
                  <input
                    value={draft.username}
                    onChange={(event) =>
                      setDraft({ ...draft, username: event.target.value })
                    }
                    placeholder="例如 amy01"
                    autoComplete="off"
                  />
                </label>
              </div>
              <label>
                <span>{draft.id ? '重置登录密码' : '登录密码'}</span>
                <input
                  type="password"
                  value={draft.password}
                  onChange={(event) =>
                    setDraft({ ...draft, password: event.target.value })
                  }
                  placeholder={
                    draft.id ? '留空表示不修改密码' : '至少 4 个字符'
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>最大同时会话数</span>
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
                <small>填写 0 表示不限制。</small>
              </label>
              <fieldset>
                <legend>所属客服分组</legend>
                <div className="modal-group-grid">
                  {groups
                    .filter((group) => group.isEnabled)
                    .map((group) => (
                      <label key={group.id} className="modal-group-option">
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
                    <span className="muted">
                      当前没有可用客服分组，可以先创建账号后再配置。
                    </span>
                  )}
                </div>
              </fieldset>
              <label className="account-enable-line">
                <input
                  type="checkbox"
                  checked={draft.isEnabled}
                  onChange={(event) =>
                    setDraft({ ...draft, isEnabled: event.target.checked })
                  }
                />
                <span>
                  <strong>启用客服账号</strong>
                  <small>停用后该客服无法登录，也不会参与新会话分流。</small>
                </span>
              </label>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={saving}
                  onClick={() => setEditorOpen(false)}
                >
                  取消
                </button>
                <button
                  className="primary-button"
                  disabled={
                    saving || !draft.name.trim() || !draft.username.trim()
                  }
                >
                  {saving ? '保存中…' : draft.id ? '保存修改' : '创建客服'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
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
  const [overview, setOverview] = useState({
    open: 0,
    pending: 0,
    closed: 0,
    total: 0,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mediaItems, setMediaItems] = useState<AgentMediaItem[]>([]);
  const [mediaProgress, setMediaProgress] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [inboxConnected, setInboxConnected] = useState(false);
  const [threadConnected, setThreadConnected] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastScrolledConversationRef = useRef<string | null>(null);
  const baseTitleRef = useRef(document.title);
  const totalUnread = useMemo(
    () => conversations.reduce((sum, item) => sum + item.agent_unread_count, 0),
    [conversations],
  );
  const lastVisibleVisitorMessageId = useMemo(
    () =>
      detail?.messages
        .slice()
        .reverse()
        .find((item) => item.sender_type === 'visitor')?.id ?? null,
    [detail],
  );

  const acknowledgeConversation = useCallback(
    async (id: string, lastMessageId: string | null = null) => {
      await markConversationRead(id, lastMessageId);
      setConversations((current) =>
        current.map((item) =>
          item.id === id ? { ...item, agent_unread_count: 0 } : item,
        ),
      );
    },
    [],
  );

  useEffect(() => {
    const baseTitle = baseTitleRef.current;
    document.title =
      totalUnread > 0 ? `(${totalUnread}) ${baseTitle}` : baseTitle;
    return () => {
      document.title = baseTitle;
    };
  }, [totalUnread]);

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
    const beat = () => void heartbeat().catch(() => undefined);
    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      beat();
      void refresh().catch(() => undefined);
      if (selectedId) {
        void acknowledgeConversation(
          selectedId,
          lastVisibleVisitorMessageId,
        ).catch(() => undefined);
      }
    };

    beat();
    const timer = window.setInterval(beat, 30_000);
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
    };
  }, [
    acknowledgeConversation,
    lastVisibleVisitorMessageId,
    refresh,
    selectedId,
  ]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let openedOnce = false;
    const connect = () => {
      if (!active) return;
      socket = openAgentInboxSocket();
      socket.addEventListener('open', () => {
        if (!active) return;
        setInboxConnected(true);
        if (openedOnce) void refresh().catch(() => undefined);
        openedOnce = true;
      });
      socket.addEventListener('message', () => {
        if (active) void refresh().catch(() => undefined);
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setInboxConnected(false);
        timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    connect();
    return () => {
      active = false;
      setInboxConnected(false);
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setMediaItems([]);
      setThreadConnected(false);
      lastScrolledConversationRef.current = null;
      return;
    }
    let active = true;
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let openedOnce = false;
    const load = () =>
      Promise.all([getConversation(selectedId), getAgentMedia(selectedId)])
        .then(([value, media]) => {
          if (active) {
            setDetail(value);
            setMediaItems(media);
            if (document.visibilityState === 'visible') {
              const lastVisitorMessageId =
                value.messages
                  .slice()
                  .reverse()
                  .find((item) => item.sender_type === 'visitor')?.id ?? null;
              void acknowledgeConversation(
                selectedId,
                lastVisitorMessageId,
              ).catch(() => undefined);
            }
          }
        })
        .catch((reason) => {
          if (active) setError(message(reason, '无法加载会话'));
        });
    const connect = () => {
      if (!active) return;
      socket = openConversationSocket(selectedId);
      socket.addEventListener('open', () => {
        if (!active) return;
        setThreadConnected(true);
        if (openedOnce) void load();
        openedOnce = true;
      });
      socket.addEventListener('message', () => {
        if (active) void load();
      });
      socket.addEventListener('close', () => {
        if (!active) return;
        setThreadConnected(false);
        timer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener('error', () => socket?.close());
    };
    void load();
    connect();
    return () => {
      active = false;
      setThreadConnected(false);
      socket?.close();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [acknowledgeConversation, selectedId]);

  const lastMessageId = detail?.messages.at(-1)?.id ?? null;
  useLayoutEffect(() => {
    const timeline = messagesRef.current;
    if (!timeline || !selectedId) return;
    const isOpeningConversation =
      lastScrolledConversationRef.current !== selectedId;
    const scroll = () => {
      if (isOpeningConversation) {
        timeline.scrollTop = timeline.scrollHeight;
        lastScrolledConversationRef.current = selectedId;
        return;
      }
      timeline.scrollTo({ top: timeline.scrollHeight, behavior: 'smooth' });
    };
    scroll();
    const frame = window.requestAnimationFrame(scroll);
    return () => window.cancelAnimationFrame(frame);
  }, [lastMessageId, selectedId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !draft.trim() || sending) return;
    const text = draft.trim();
    setSending(true);
    setDraft('');
    try {
      await sendMessage(selectedId, text);
      setDetail(await getConversation(selectedId));
    } catch (reason) {
      setDraft((current) => current || text);
      setError(message(reason, '发送失败'));
    } finally {
      setSending(false);
    }
  }

  async function submitImage(file: File) {
    if (!selectedId) return;
    setMediaProgress(0);
    try {
      await sendAgentImage(selectedId, file, setMediaProgress);
      const [nextDetail, nextMedia] = await Promise.all([
        getConversation(selectedId),
        getAgentMedia(selectedId),
      ]);
      setDetail(nextDetail);
      setMediaItems(nextMedia);
    } catch (reason) {
      setError(message(reason, '图片发送失败'));
    } finally {
      setMediaProgress(null);
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
            <h1>
              我的会话
              {totalUnread > 0 && (
                <span className="unread-total">{totalUnread}</span>
              )}
            </h1>
          </div>
          <span className="online-pill" aria-live="polite">
            {inboxConnected && (!selectedId || threadConnected)
              ? '实时在线'
              : '正在重连'}
          </span>
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
                className={[
                  'conversation-row',
                  conversation.id === selectedId ? 'selected' : '',
                  conversation.agent_unread_count > 0 ? 'unread' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setSelectedId(conversation.id)}
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

      <main className="thread-pane">
        {error && (
          <button
            className="notice error floating"
            onClick={() => setError('')}
          >
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
                <p>
                  {String(
                    detail.conversation.product_title ||
                      detail.conversation.subject ||
                      '访客咨询',
                  )}
                </p>
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
                <option value="open">新会话</option>
                <option value="pending">处理中</option>
                <option value="closed">已关闭</option>
              </select>
            </header>
            <div className="messages" ref={messagesRef}>
              {(detail.messages as Message[]).map((item) => (
                <Bubble
                  key={item.id}
                  message={item}
                  media={
                    mediaItems.find((media) => media.messageId === item.id) ??
                    null
                  }
                />
              ))}
            </div>
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <label className="media-picker" aria-label="发送图片">
                ＋
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  disabled={
                    detail.conversation.status === 'closed' ||
                    mediaProgress !== null
                  }
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void submitImage(file);
                  }}
                />
              </label>
              <textarea
                value={draft}
                rows={3}
                disabled={detail.conversation.status === 'closed'}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  detail.conversation.status === 'closed'
                    ? '会话已关闭'
                    : '输入回复内容…'
                }
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="composer-foot">
                <span className="media-upload-progress">
                  {mediaProgress === null
                    ? 'Enter 发送 · Shift + Enter 换行'
                    : `图片上传 ${Math.round(mediaProgress * 100)}%`}
                </span>
                <button
                  className="primary-button"
                  disabled={
                    sending ||
                    !draft.trim() ||
                    detail.conversation.status === 'closed'
                  }
                >
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
    <AuthPage
      eyebrow="MANAGEMENT"
      title="登录客服管理中心"
      description="管理员只负责客服账号、分组和分流配置。"
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

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
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
