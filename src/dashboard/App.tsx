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
  AgentRoutingScope,
  AgentMonthlyStats,
  ProductCatalogItem,
  AgentIdentity,
  Conversation,
  ConversationDetail,
  Message,
  Overview,
  adminLogin,
  adminLogout,
  agentLogin,
  agentLogout,
  createAgent,
  getAdminSession,
  getAgentMonthlyStats,
  getAgentSession,
  getAgents,
  getConversation,
  getConversations,
  getOverview,
  getProductCatalog,
  heartbeat,
  markConversationRead,
  openAgentInboxSocket,
  openConversationSocket,
  sendMessage,
  setConversationStatus,
  updateAgent,
} from './api';
import { ProductAssignmentPicker } from './ProductAssignmentPicker';
import { AgentStatisticsModal } from './AgentStatisticsWorkspace';
import {
  getAgentMedia,
  sendAgentImage,
  type AgentMediaItem,
} from './agent-media';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];
type AdminSection = 'agents' | 'workspace';
type UiIconName = 'agents' | 'statistics' | 'workspace' | 'external' | 'logout';

function UiIcon({ name }: { name: UiIconName }) {
  const paths: Record<UiIconName, React.ReactNode> = {
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
  isEnabled: true,
};

const filterLabels: Record<Filter, string> = {
  all: '全部',
  open: '新会话',
  pending: '处理中',
  closed: '已关闭',
};

const CHAT_TIME_ZONE = 'America/Los_Angeles';

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
  const [products, setProducts] = useState<ProductCatalogItem[]>([]);
  const [section, setSection] = useState<AdminSection>('agents');
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [statsMonth, setStatsMonth] = useState(() => currentBusinessMonth());
  const [monthlyStats, setMonthlyStats] = useState<AgentMonthlyStats | null>(
    null,
  );
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsError, setStatsError] = useState('');

  const refresh = useCallback(async () => {
    const [nextAgents, nextProducts] = await Promise.all([
      getAgents(),
      getProductCatalog(),
    ]);
    setAgents(nextAgents);
    setProducts(nextProducts);
  }, []);

  useEffect(() => {
    refresh()
      .catch((reason) => setError(message(reason, '无法加载配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

  useEffect(() => {
    if (!statisticsOpen) return;
    let active = true;
    setStatsError('');
    setStatsBusy(true);
    getAgentMonthlyStats(statsMonth)
      .then((result) => {
        if (active) setMonthlyStats(result);
      })
      .catch((reason) => {
        if (active) setStatsError(message(reason, '无法加载会话统计'));
      })
      .finally(() => {
        if (active) setStatsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [statisticsOpen, statsMonth]);

  useEffect(() => {
    if (!statisticsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStatisticsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [statisticsOpen]);

  useEffect(() => {
    if (!editorOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editorOpen, saving]);

  const workspaceUrl = `${window.location.origin}/agent`;
  const onlineCount = agents.filter(
    (agent) => agent.isEnabled && agent.status === 'online',
  ).length;
  const enabledCount = agents.filter((agent) => agent.isEnabled).length;
  const assignedProductCount = new Set(
    agents.flatMap((agent) =>
      productsForScope(agent.routingScope, products).map(
        (product) => product.id,
      ),
    ),
  ).size;

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
      routingScope: agent.routingScope,
      maxActiveConversations: agent.maxActiveConversations,
      dailyConversationLimit: agent.dailyConversationLimit,
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
          routingScope: draft.routingScope,
          maxActiveConversations: draft.maxActiveConversations,
          dailyConversationLimit: draft.dailyConversationLimit,
          isEnabled: draft.isEnabled,
        });
      } else {
        await createAgent({
          name: draft.name,
          username: draft.username,
          password: draft.password,
          routingScope: draft.routingScope,
          maxActiveConversations: draft.maxActiveConversations,
          dailyConversationLimit: draft.dailyConversationLimit,
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

  async function copyWorkspaceUrl() {
    try {
      await navigator.clipboard.writeText(workspaceUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('无法复制链接，请手动复制。');
    }
  }

  const sectionTitle = section === 'agents' ? '客服坐席' : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并配置负责范围、同时会话上限和每日接待配额。'
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
            type="button"
            className={section === 'agents' && !statisticsOpen ? 'active' : ''}
            onClick={() => setSection('agents')}
          >
            <span className="admin-nav-label">
              <UiIcon name="agents" />
              <span>客服账号</span>
            </span>
            <small>{agents.length}</small>
          </button>
          <button
            type="button"
            className={statisticsOpen ? 'active' : ''}
            onClick={() => {
              setStatsBusy(true);
              setStatisticsOpen(true);
            }}
          >
            <span className="admin-nav-label">
              <UiIcon name="statistics" />
              <span>会话统计</span>
            </span>
            <small>1–30 日</small>
          </button>
          <button
            type="button"
            className={
              section === 'workspace' && !statisticsOpen ? 'active' : ''
            }
            onClick={() => setSection('workspace')}
          >
            <span className="admin-nav-label">
              <UiIcon name="workspace" />
              <span>坐席工作台</span>
            </span>
            <small>员工入口</small>
          </button>
        </nav>
        <div className="admin-sidebar-foot">
          <a href="/agent" target="_blank" rel="noreferrer">
            <span>
              <UiIcon name="external" />
              打开坐席工作台
            </span>
          </a>
          <button type="button" onClick={() => void onLogout()}>
            <span>
              <UiIcon name="logout" />
              退出管理
            </span>
          </button>
        </div>
      </aside>

      <main className="admin-content">
        <header className="admin-content-head">
          <div>
            <h1>{sectionTitle}</h1>
            <p>{sectionHint}</p>
          </div>
          {section === 'agents' && (
            <button
              type="button"
              className="primary-button"
              onClick={createNewAgent}
            >
              新增客服
            </button>
          )}
        </header>

        {error && (
          <button
            type="button"
            className="notice error"
            onClick={() => setError('')}
          >
            {error}
          </button>
        )}

        {section === 'agents' && (
          <div className="admin-agent-layout">
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
                <span>已覆盖产品</span>
                <strong>{assignedProductCount}</strong>
              </div>
            </section>
            <section className="admin-table-card">
              <div className="admin-table-title">
                <div>
                  <strong>客服账号列表</strong>
                  <span>
                    负责范围以动态分流规则保存，分区和分类后续新增产品会自动纳入
                  </span>
                </div>
              </div>
              {busy ? (
                <div className="empty-state">正在加载客服账号…</div>
              ) : agents.length === 0 ? (
                <div className="empty-state admin-empty">
                  <strong>还没有客服账号</strong>
                  <span>创建第一个客服账号后，再配置它的分流负责范围。</span>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={createNewAgent}
                  >
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
                        <th>负责范围</th>
                        <th>状态</th>
                        <th>同时会话</th>
                        <th>今日接待</th>
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
                            {(() => {
                              const summary = agentScopeSummary(
                                agent,
                                products,
                              );
                              return (
                                <div
                                  className={`agent-scope-summary ${summary.tone}`}
                                >
                                  <strong>{summary.title}</strong>
                                  <small>{summary.detail}</small>
                                </div>
                              );
                            })()}
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
                            <div className="daily-quota-cell">
                              <strong>
                                {agent.todayConversationCount}
                                <span>/</span>
                                {agent.dailyConversationLimit || '∞'}
                              </strong>
                              {agent.dailyConversationLimit > 0 ? (
                                <span
                                  className={`quota-state ${
                                    agent.todayConversationCount >=
                                    agent.dailyConversationLimit
                                      ? 'full'
                                      : ''
                                  }`}
                                >
                                  {agent.todayConversationCount >=
                                  agent.dailyConversationLimit
                                    ? '今日已满'
                                    : `剩余 ${Math.max(
                                        0,
                                        agent.dailyConversationLimit -
                                          agent.todayConversationCount,
                                      )}`}
                                </span>
                              ) : (
                                <span className="quota-state">不限</span>
                              )}
                            </div>
                          </td>
                          <td>
                            {agent.lastSeenAt
                              ? relativeTime(agent.lastSeenAt)
                              : '从未登录'}
                          </td>
                          <td>
                            <button
                              type="button"
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
          </div>
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
                  type="button"
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

      {statisticsOpen && (
        <div
          className="modal-backdrop admin-statistics-backdrop"
          onMouseDown={() => setStatisticsOpen(false)}
        >
          <section
            className="admin-statistics-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-statistics-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="admin-statistics-modal-head">
              <div>
                <span className="eyebrow">运营数据</span>
                <h2 id="admin-statistics-title">会话统计</h2>
                <p>按客服查看每天实际接收的新会话，日期数据无需横向拖动。</p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="关闭会话统计"
                onClick={() => setStatisticsOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="admin-statistics-modal-body">
              {statsError && (
                <button
                  type="button"
                  className="notice error"
                  onClick={() => setStatsError('')}
                >
                  {statsError}
                </button>
              )}
              <MonthlyAgentStatistics
                agents={agents}
                month={statsMonth}
                stats={monthlyStats}
                busy={statsBusy}
                onMonthChange={(month) => {
                  setStatsBusy(true);
                  setStatsMonth(month);
                }}
              />
            </div>
          </section>
        </div>
      )}

      {editorOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !saving && setEditorOpen(false)}
        >
          <section
            className="agent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-editor-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id="agent-editor-title">
                  {draft.id ? '编辑客服账号' : '新增客服账号'}
                </h2>
                <p>账号与分流负责范围由管理员统一配置。</p>
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
              <div className="agent-editor-layout">
                <aside className="agent-editor-account-pane">
                  <div className="agent-editor-pane-heading">
                    <span>01</span>
                    <div>
                      <strong>账号与接待能力</strong>
                      <small>登录身份、并发与每日配额</small>
                    </div>
                  </div>
                  <div className="agent-editor-identity-preview">
                    <span>{initials(draft.name || '客服')}</span>
                    <div>
                      <strong>{draft.name.trim() || '新客服'}</strong>
                      <small>@{draft.username.trim() || '登录账号'}</small>
                    </div>
                  </div>
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
                  <div className="agent-editor-limits">
                    <label>
                      <span>同时会话</span>
                      <input
                        type="number"
                        min="0"
                        max="999"
                        value={draft.maxActiveConversations}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            maxActiveConversations:
                              Number(event.target.value) || 0,
                          })
                        }
                      />
                      <small>0 表示不限</small>
                    </label>
                    <label>
                      <span>每日接待</span>
                      <input
                        type="number"
                        min="0"
                        max="9999"
                        value={draft.dailyConversationLimit}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            dailyConversationLimit:
                              Number(event.target.value) || 0,
                          })
                        }
                      />
                      <small>次日自动恢复，0 表示不限</small>
                    </label>
                  </div>
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
                      <small>关闭后立即停止登录和新会话分流</small>
                    </span>
                  </label>
                </aside>
                <section className="agent-editor-routing-pane">
                  <div className="agent-editor-pane-heading">
                    <span>02</span>
                    <div>
                      <strong>分流负责范围</strong>
                      <small>分区可多选，分类批量负责，产品用于精确指定</small>
                    </div>
                  </div>
                  <ProductAssignmentPicker
                    products={products}
                    scope={draft.routingScope}
                    disabled={saving}
                    onChange={(routingScope) =>
                      setDraft({ ...draft, routingScope })
                    }
                  />
                </section>
              </div>
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

function MonthlyAgentStatistics({
  agents,
  month,
  stats,
  busy,
  onMonthChange,
}: {
  agents: AgentAccount[];
  month: string;
  stats: AgentMonthlyStats | null;
  busy: boolean;
  onMonthChange: (month: string) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.counts ?? []) {
      map.set(`${item.agentId}:${item.day}`, item.count);
    }
    return map;
  }, [stats]);
  const days =
    stats?.days ?? Array.from({ length: 30 }, (_, index) => index + 1);
  const agentTotals = new Map(
    agents.map((agent) => [
      agent.id,
      days.reduce(
        (sum, day) => sum + (countMap.get(`${agent.id}:${day}`) ?? 0),
        0,
      ),
    ]),
  );
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedTotal = selectedAgent
    ? (agentTotals.get(selectedAgent.id) ?? 0)
    : 0;
  const selectedActiveDays = selectedAgent
    ? days.filter(
        (day) => (countMap.get(`${selectedAgent.id}:${day}`) ?? 0) > 0,
      ).length
    : 0;
  const selectedDailyAverage = days.length
    ? (selectedTotal / days.length).toFixed(1)
    : '0.0';

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId) setSelectedAgentId('');
      return;
    }
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  return (
    <section className="statistics-panel">
      <div className="statistics-toolbar">
        <div>
          <strong>按坐席统计</strong>
          <span>选择客服坐席，查看该坐席每天实际接收的新会话</span>
        </div>
        <label>
          <span>月份</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>
      {selectedAgent ? (
        <div className="statistics-seat-layout">
          <aside className="statistics-seat-sidebar">
            <header>
              <div>
                <strong>客服坐席</strong>
                <span>{agents.length} 个账号</span>
              </div>
              <small>本月接待</small>
            </header>
            <nav aria-label="选择客服坐席">
              {agents.map((agent) => {
                const isSelected = agent.id === selectedAgent.id;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={isSelected ? 'active' : ''}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span className="avatar tiny">{initials(agent.name)}</span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>@{agent.username || '未设置账号'}</small>
                    </span>
                    <b>{busy ? '—' : (agentTotals.get(agent.id) ?? 0)}</b>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="statistics-seat-detail" aria-live="polite">
            <header className="statistics-seat-head">
              <div className="statistics-agent-identity">
                <span className="avatar small">
                  {initials(selectedAgent.name)}
                </span>
                <div>
                  <span>当前坐席</span>
                  <strong>{selectedAgent.name}</strong>
                  <small>@{selectedAgent.username || '未设置账号'}</small>
                </div>
              </div>
              <span
                className={`account-status ${presenceClass(selectedAgent)}`}
              >
                {selectedAgent.isEnabled
                  ? statusLabel(selectedAgent.status)
                  : '已停用'}
              </span>
            </header>

            <div className="statistics-summary">
              <div>
                <span>本月接待</span>
                <strong>{busy ? '—' : selectedTotal}</strong>
              </div>
              <div>
                <span>有接待天数</span>
                <strong>{busy ? '—' : selectedActiveDays}</strong>
              </div>
              <div>
                <span>日均接待</span>
                <strong>{busy ? '—' : selectedDailyAverage}</strong>
              </div>
            </div>

            <div className="statistics-day-section">
              <header>
                <div>
                  <strong>每日新会话</strong>
                  <span>会话首次分配给该坐席时计 1 次</span>
                </div>
                <small>1–30 日</small>
              </header>
              <div className="statistics-day-grid">
                {days.map((day) => {
                  const value = countMap.get(`${selectedAgent.id}:${day}`) ?? 0;
                  return (
                    <div key={day} className={value ? 'has-value' : ''}>
                      <span>{day} 日</span>
                      <strong>{busy ? '·' : value || '—'}</strong>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : (
        <div className="statistics-empty">
          <strong>暂无客服坐席</strong>
          <span>创建客服账号后，这里会按坐席显示每日接待数量。</span>
        </div>
      )}
      <p className="statistics-note">
        每日上限按 America/Los_Angeles 自然日计算；统计数据独立于 24
        小时聊天记录保存并保留 45
        天。达到上限后仅停止接收新会话，已分配会话仍可继续处理。31
        日会正常参与每日限额，但月度表按要求只展示 1–30 日。
      </p>
    </section>
  );
}

function currentBusinessMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}`;
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

  const onLogout = async () => {
    await agentLogout();
    setIdentity(null);
    setState('signed-out');
  };

  return <AgentWorkspace identity={identity} onLogout={onLogout} />;
}

function AgentWorkspace({
  identity,
  onLogout,
}: {
  identity: AgentIdentity;
  onLogout: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [statisticsOpen, setStatisticsOpen] = useState(() =>
    window.location.pathname.startsWith('/agent/stats'),
  );
  const [overview, setOverview] = useState({
    open: 0,
    pending: 0,
    closed: 0,
    total: 0,
    todayAccepted: 0,
    dailyLimit: 0,
  });
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [mediaItems, setMediaItems] = useState<AgentMediaItem[]>([]);
  const [mediaProgress, setMediaProgress] = useState<number | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaPendingFile, setMediaPendingFile] = useState<File | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
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

  useEffect(() => {
    if (!window.location.pathname.startsWith('/agent/stats')) return;
    window.history.replaceState(null, '', '/agent');
  }, []);

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
    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      void heartbeat()
        .catch(() => undefined)
        .finally(() => void refresh().catch(() => undefined));
      if (selectedId) {
        void acknowledgeConversation(
          selectedId,
          lastVisibleVisitorMessageId,
        ).catch(() => undefined);
      }
    };

    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
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
        if (openedOnce) {
          void heartbeat()
            .catch(() => undefined)
            .finally(() => void refresh().catch(() => undefined));
        }
        openedOnce = true;
      });
      socket.addEventListener('message', (event) => {
        if (!active) return;
        const payload = parseRealtimeEvent<InboxRealtimeEvent>(event);
        if (!payload || payload.type === 'ready' || payload.type === 'pong')
          return;
        if (payload.type !== 'conversation.changed' || !payload.conversation) {
          void refresh().catch(() => undefined);
          return;
        }

        const next = payload.conversation;
        const belongsToAgent = next.assigned_agent === identity.id;
        setConversations((current) => {
          const withoutCurrent = current.filter((item) => item.id !== next.id);
          if (!belongsToAgent) return withoutCurrent;
          if (filter !== 'all' && next.status !== filter) return withoutCurrent;
          return sortedConversationList([next, ...withoutCurrent]);
        });
        if (belongsToAgent && payload.overview) setOverview(payload.overview);
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
  }, [filter, identity.id, refresh]);

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
      socket.addEventListener('message', (event) => {
        if (!active) return;
        const payload = parseRealtimeEvent<ThreadRealtimeEvent>(event);
        if (!payload || payload.type === 'ready' || payload.type === 'pong')
          return;

        if (payload.type === 'message' && payload.message) {
          const incoming = payload.message;
          setDetail((current) => {
            if (!current || current.conversation.id !== selectedId)
              return current;
            const exists = current.messages.some(
              (item) => item.id === incoming.id,
            );
            return {
              ...current,
              conversation: {
                ...current.conversation,
                last_message: incoming.body,
                last_message_at: incoming.created_at,
              },
              messages: exists
                ? current.messages.map((item) =>
                    item.id === incoming.id ? incoming : item,
                  )
                : [...current.messages, incoming],
            };
          });
          if (payload.media?.id && payload.media.messageId) {
            const media: AgentMediaItem = {
              ...payload.media,
              url: `/api/agent/media/${encodeURIComponent(payload.media.id)}/content`,
            };
            setMediaItems((current) =>
              current.some((item) => item.id === media.id)
                ? current.map((item) => (item.id === media.id ? media : item))
                : [...current, media],
            );
          }
          if (
            incoming.sender_type === 'visitor' &&
            document.visibilityState === 'visible'
          ) {
            void acknowledgeConversation(selectedId, incoming.id).catch(
              () => undefined,
            );
          }
          return;
        }

        if (payload.type === 'message.read') {
          const readAt = new Date().toISOString();
          setDetail((current) => {
            if (!current || current.conversation.id !== selectedId)
              return current;
            return {
              ...current,
              messages: current.messages.map((item) => {
                if (
                  payload.reader === 'visitor' &&
                  item.sender_type === 'agent'
                ) {
                  return {
                    ...item,
                    read_by_visitor_at: item.read_by_visitor_at ?? readAt,
                  };
                }
                if (
                  payload.reader === 'agent' &&
                  item.sender_type === 'visitor'
                ) {
                  return {
                    ...item,
                    read_by_agent_at: item.read_by_agent_at ?? readAt,
                  };
                }
                return item;
              }),
            };
          });
          return;
        }

        if (payload.type === 'conversation.status' && payload.status) {
          setDetail((current) =>
            current && current.conversation.id === selectedId
              ? {
                  ...current,
                  conversation: {
                    ...current.conversation,
                    status: payload.status!,
                  },
                }
              : current,
          );
          setConversations((current) =>
            current.map((item) =>
              item.id === selectedId
                ? { ...item, status: payload.status! }
                : item,
            ),
          );
          return;
        }

        void load();
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
  const selectedExpiresAt = detail?.conversation.expires_at ?? null;

  useEffect(() => {
    setMediaPendingFile(null);
    setMediaFailed(false);
    setMediaProgress(null);
    setMediaPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedExpiresAt) return;
    const expiresAt = Date.parse(selectedExpiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const expire = () => {
      setSelectedId(null);
      setDetail(null);
      setMediaItems([]);
      void refresh().catch(() => undefined);
    };
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining + 100);
    return () => window.clearTimeout(timer);
  }, [refresh, selectedExpiresAt, selectedId]);
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
      const sent = await sendMessage(selectedId, text);
      setDetail((current) => {
        if (!current || current.conversation.id !== selectedId) return current;
        const exists = current.messages.some((item) => item.id === sent.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: sent.body,
            last_message_at: sent.created_at,
          },
          messages: exists ? current.messages : [...current.messages, sent],
        };
      });
    } catch (reason) {
      setDraft((current) => current || text);
      setError(message(reason, '发送失败'));
    } finally {
      setSending(false);
    }
  }

  async function uploadImage(file: File, previewUrl: string) {
    if (!selectedId) return;
    setMediaProgress(0);
    setMediaFailed(false);
    try {
      const sent = await sendAgentImage(selectedId, file, setMediaProgress);
      const message: Message = {
        id: sent.messageId,
        conversation_id: selectedId,
        sender_type: 'agent',
        sender_id: identity.id,
        body: '',
        read_by_visitor_at: null,
        read_by_agent_at: null,
        created_at: sent.createdAt,
      };
      setDetail((current) => {
        if (!current || current.conversation.id !== selectedId) return current;
        const exists = current.messages.some((item) => item.id === message.id);
        return {
          ...current,
          conversation: {
            ...current.conversation,
            last_message: '',
            last_message_at: sent.createdAt,
          },
          messages: exists ? current.messages : [...current.messages, message],
        };
      });
      setMediaItems((current) =>
        current.some((item) => item.id === sent.media.id)
          ? current.map((item) =>
              item.id === sent.media.id ? sent.media : item,
            )
          : [...current, sent.media],
      );
      setMediaPendingFile(null);
      setMediaPreviewUrl(null);
      URL.revokeObjectURL(previewUrl);
    } catch (reason) {
      setMediaFailed(true);
      setError(message(reason, '图片发送失败'));
    } finally {
      setMediaProgress(null);
    }
  }

  async function submitImage(file: File) {
    if (!selectedId) return;
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    const previewUrl = URL.createObjectURL(file);
    setMediaPreviewUrl(previewUrl);
    setMediaPendingFile(file);
    await uploadImage(file, previewUrl);
  }

  async function retryImage() {
    if (!mediaPendingFile || !mediaPreviewUrl || mediaProgress !== null) return;
    await uploadImage(mediaPendingFile, mediaPreviewUrl);
  }

  async function changeStatus(status: Conversation['status']) {
    if (!selectedId) return;
    const previousStatus = detail?.conversation.status as
      Conversation['status'] | undefined;
    try {
      await setConversationStatus(selectedId, status);
      setDetail((current) =>
        current && current.conversation.id === selectedId
          ? {
              ...current,
              conversation: { ...current.conversation, status },
            }
          : current,
      );
      setConversations((current) => {
        const updated = current.map((item) =>
          item.id === selectedId ? { ...item, status } : item,
        );
        return filter !== 'all' && status !== filter
          ? updated.filter((item) => item.id !== selectedId)
          : updated;
      });
      if (previousStatus && previousStatus !== status) {
        setOverview((current) => ({
          ...current,
          [previousStatus]: Math.max(0, current[previousStatus] - 1),
          [status]: current[status] + 1,
        }));
      }
    } catch (reason) {
      setError(message(reason, '更新会话状态失败'));
    }
  }

  return (
    <div className={`workspace-shell${selectedId ? ' is-thread-open' : ''}`}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand-lockup">
          <div className="workspace-brand">CS</div>
          <span>坐席中心</span>
        </div>
        <div className="agent-profile">
          <span className="avatar">{initials(identity.name)}</span>
          <div>
            <strong>{identity.name}</strong>
            <small>@{identity.username}</small>
          </div>
          <i className="presence online" />
        </div>
        <div className="workspace-sidebar-actions">
          <button
            type="button"
            className="ghost-button full workspace-statistics-button"
            aria-label="打开会话统计"
            title="会话统计"
            onClick={() => setStatisticsOpen(true)}
          >
            <UiIcon name="statistics" />
            <span>会话统计</span>
          </button>
          <button
            type="button"
            className="ghost-button full workspace-logout-button"
            aria-label="退出客服账号"
            title="退出客服账号"
            onClick={() => void onLogout()}
          >
            <UiIcon name="logout" />
            <span>退出客服账号</span>
          </button>
        </div>
      </aside>

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
          <span className="online-pill" aria-live="polite">
            {inboxConnected && (!selectedId || threadConnected)
              ? '实时在线'
              : '正在重连'}
          </span>
        </header>
        <div className="inbox-overview" aria-label="会话概览">
          <Metric label="新会话" value={overview.open} />
          <Metric label="处理中" value={overview.pending} />
          <Metric label="已关闭" value={overview.closed} />
        </div>
        <div className="filters">
          {(Object.keys(filterLabels) as Filter[]).map((item) => (
            <button
              type="button"
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
              <span>
                保持在线，负责产品的新会话会在对应在线客服之间自动轮询。
              </span>
            </div>
          ) : (
            conversations.map((conversation) => (
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
            type="button"
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
              <button
                type="button"
                className="thread-back-button"
                aria-label="返回会话列表"
                onClick={() => setSelectedId(null)}
              >
                ‹
              </button>
              <div className="thread-head-copy">
                <span className="eyebrow">当前访客</span>
                <h2>{String(detail.conversation.visitor_name || '访客')}</h2>
                <p>
                  {String(
                    detail.conversation.product_title ||
                      detail.conversation.subject ||
                      '访客咨询',
                  )}
                </p>
                <ConversationExpiryCountdown
                  expiresAt={detail.conversation.expires_at}
                />
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
              {mediaPreviewUrl ? (
                <div className="message mine is-uploading">
                  <div>
                    <div className="message-image-pending">
                      <img
                        className="message-image"
                        src={mediaPreviewUrl}
                        alt="待发送图片"
                      />
                      <button
                        type="button"
                        className={`media-inline-status${mediaFailed ? ' is-failed' : ''}`}
                        disabled={!mediaFailed || !mediaPendingFile}
                        aria-label={mediaFailed ? '重试发送图片' : '图片发送中'}
                        onClick={() => void retryImage()}
                      >
                        {mediaFailed ? (
                          '!'
                        ) : (
                          <span
                            className="media-inline-ring"
                            style={
                              {
                                '--media-upload-progress': `${Math.round((mediaProgress ?? 0) * 360)}deg`,
                              } as React.CSSProperties
                            }
                          >
                            {Math.round((mediaProgress ?? 0) * 100)}
                          </span>
                        )}
                      </button>
                    </div>
                    <span className="message-meta">
                      <span>
                        {mediaFailed ? '发送失败 · 点击重试' : '发送中'}
                      </span>
                    </span>
                  </div>
                </div>
              ) : null}
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
                  Enter 发送 · Shift + Enter 换行
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
      {statisticsOpen && (
        <AgentStatisticsModal
          identity={identity}
          onClose={() => setStatisticsOpen(false)}
        />
      )}
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
