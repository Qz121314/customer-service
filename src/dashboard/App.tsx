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
import {
  getAgentMedia,
  sendAgentImage,
  type AgentMediaItem,
} from './agent-media';

type LoadState = 'loading' | 'signed-out' | 'authenticated' | 'not-configured';
type Filter = 'all' | Conversation['status'];
type AdminSection = 'agents' | 'statistics' | 'workspace';

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
    return products.filter(
      (product) => product.isEnabled && product.sectionId === scope.sectionId,
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
    const product = products.find((item) => item.sectionId === scope.sectionId);
    const sectionName = product?.sectionName || scope.sectionId;
    return {
      tone: 'section',
      title: `${sectionName} · 整个分区`,
      detail: `动态覆盖 ${scopeProductCount(scope, products)} 个产品`,
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
    if (section !== 'statistics') return;
    let active = true;
    setStatsBusy(true);
    getAgentMonthlyStats(statsMonth)
      .then((result) => {
        if (active) setMonthlyStats(result);
      })
      .catch((reason) => {
        if (active) setError(message(reason, '无法加载会话统计'));
      })
      .finally(() => {
        if (active) setStatsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [section, statsMonth]);

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

  const sectionTitle =
    section === 'agents'
      ? '客服坐席'
      : section === 'statistics'
        ? '会话统计'
        : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并配置负责范围、同时会话上限和每日接待配额。'
      : section === 'statistics'
        ? '按客服查看所选月份 1 号到 30 号每天实际接收的新会话数量。'
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
            className={section === 'agents' ? 'active' : ''}
            onClick={() => setSection('agents')}
          >
            <span>客服账号</span>
            <small>{agents.length}</small>
          </button>
          <button
            type="button"
            className={section === 'statistics' ? 'active' : ''}
            onClick={() => setSection('statistics')}
          >
            <span>会话统计</span>
            <small>1–30 日</small>
          </button>
          <button
            type="button"
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
          <button type="button" onClick={() => void onLogout()}>
            退出管理
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
          </>
        )}

        {section === 'statistics' && (
          <MonthlyAgentStatistics
            agents={agents}
            month={statsMonth}
            stats={monthlyStats}
            busy={statsBusy}
            onMonthChange={setStatsMonth}
          />
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
              <div className="agent-editor-section-title">
                <strong>账号设置</strong>
                <span>配置坐席身份、登录凭据和同时接待上限</span>
              </div>
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
              <div className="form-two-columns quota-fields">
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
                  <small>控制正在处理中的并发会话，0 表示不限制。</small>
                </label>
                <label>
                  <span>每日会话上限</span>
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    value={draft.dailyConversationLimit}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dailyConversationLimit: Number(event.target.value) || 0,
                      })
                    }
                  />
                  <small>
                    例如 40：当天接满 40 个后停止分流，第二天自动恢复。0
                    表示不限。
                  </small>
                </label>
              </div>
              <div className="agent-editor-section-title scope-title">
                <strong>分流负责范围</strong>
                <span>分区 = 全选，分类 = 批量选择，指定产品 = 精确选择</span>
              </div>
              <ProductAssignmentPicker
                products={products}
                scope={draft.routingScope}
                disabled={saving}
                onChange={(routingScope) =>
                  setDraft({ ...draft, routingScope })
                }
              />
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
  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.counts ?? []) {
      map.set(`${item.agentId}:${item.day}`, item.count);
    }
    return map;
  }, [stats]);
  const total = (stats?.counts ?? []).reduce(
    (sum, item) => sum + item.count,
    0,
  );
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

  return (
    <section className="statistics-panel">
      <div className="statistics-toolbar">
        <div>
          <strong>每日新会话</strong>
          <span>统计口径：会话首次分配给客服时计 1 次</span>
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
      <div className="statistics-summary">
        <div>
          <span>本月 1–30 日</span>
          <strong>{busy ? '—' : total}</strong>
        </div>
        <div>
          <span>客服人数</span>
          <strong>{agents.length}</strong>
        </div>
        <div>
          <span>平均每客服</span>
          <strong>
            {agents.length && !busy ? Math.round(total / agents.length) : 0}
          </strong>
        </div>
      </div>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead>
            <tr>
              <th className="sticky-agent">客服</th>
              {days.map((day) => (
                <th key={day}>{day}</th>
              ))}
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <th className="sticky-agent">
                  <strong>{agent.name}</strong>
                  <small>{agent.username || '—'}</small>
                </th>
                {days.map((day) => {
                  const value = countMap.get(`${agent.id}:${day}`) ?? 0;
                  return (
                    <td key={day} className={value ? 'has-value' : ''}>
                      {busy ? '·' : value || '—'}
                    </td>
                  );
                })}
                <td className="statistics-total">
                  {busy ? '—' : (agentTotals.get(agent.id) ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="statistics-note">
        每日上限按 America/Los_Angeles 自然日计算；达到上限后仅停止接收新会话，已分配会话仍可继续处理。31
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
  const [