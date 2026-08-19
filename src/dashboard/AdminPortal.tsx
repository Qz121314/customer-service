import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AgentAccount,
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  AgentMonthlyStats,
  ProductCatalogItem,
  adminLogin,
  adminLogout,
  createAgent,
  getAdminSession,
  getAgentMonthlyStats,
  getAgentQuotaLedger,
  getAgents,
  getProductCatalog,
  updateAgent,
} from './api';
import {
  LoadState,
  AdminSection,
  AgentDraft,
  emptyAgentDraft,
  CHAT_TIME_ZONE,
  productsForScope,
  agentScopeSummary,
  presenceClass,
  statusLabel,
  relativeTime,
  initials,
  message,
} from './dashboard-runtime';
import { UiIcon, AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { AdminStatisticsPage } from './AdminStatisticsPage';
import { AgentEditorModal } from './AgentEditorModal';

type AdminView = AdminSection | 'statistics';

export function AdminPortal() {
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
  const [section, setSection] = useState<AdminView>('agents');
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
  const [quotaAdjustments, setQuotaAdjustments] = useState<
    AgentQuotaAdjustment[]
  >([]);
  const [quotaLedger, setQuotaLedger] = useState<AgentQuotaLedger | null>(null);
  const [quotaHistoryBusy, setQuotaHistoryBusy] = useState(false);
  const [quotaHistoryError, setQuotaHistoryError] = useState('');

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
    setStatsError('');
    setStatsBusy(true);
    getAgentMonthlyStats(statsMonth)
      .then((result) => {
        if (active) setMonthlyStats(result);
      })
      .catch((reason) => {
        if (active) setStatsError(message(reason, '无法加载坐席流量'));
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

  function resetQuotaLedgerState() {
    setQuotaAdjustments([]);
    setQuotaLedger(null);
    setQuotaHistoryBusy(false);
    setQuotaHistoryError('');
  }

  function createNewAgent() {
    setDraft({
      ...emptyAgentDraft,
      trafficQuotaRequestId: crypto.randomUUID(),
    });
    resetQuotaLedgerState();
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
      trafficQuotaEnabled: agent.trafficQuotaEnabled,
      trafficQuotaTotal: agent.trafficQuotaTotal,
      trafficQuotaUsed: agent.trafficQuotaUsed,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: crypto.randomUUID(),
      isEnabled: agent.isEnabled,
    });
    resetQuotaLedgerState();
    setEditorOpen(true);
    setError('');
  }

  async function loadQuotaLedger() {
    if (!draft.id || quotaHistoryBusy) return;
    setQuotaHistoryBusy(true);
    setQuotaHistoryError('');
    try {
      const result = await getAgentQuotaLedger(draft.id);
      setQuotaAdjustments(result.adjustments);
      setQuotaLedger(result.ledger);
    } catch (reason) {
      setQuotaHistoryError(message(reason, '无法核对咨询额度账本'));
    } finally {
      setQuotaHistoryBusy(false);
    }
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
          trafficQuotaEnabled: draft.trafficQuotaEnabled,
          trafficQuotaTopUp: draft.trafficQuotaTopUp,
          trafficQuotaRequestId: draft.trafficQuotaRequestId,
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
          trafficQuotaEnabled: draft.trafficQuotaEnabled,
          trafficQuotaTopUp: draft.trafficQuotaTopUp,
          trafficQuotaRequestId: draft.trafficQuotaRequestId,
          isEnabled: draft.isEnabled,
        });
      }
      setEditorOpen(false);
      setDraft(emptyAgentDraft);
      resetQuotaLedgerState();
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
        ? '坐席流量'
        : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '集中管理客服账号、接待能力、咨询额度与分流负责范围。'
      : section === 'statistics'
        ? '按自然月核对每个客服首次实际接收的访客流量。'
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
            <span className="admin-nav-label">
              <UiIcon name="agents" />
              <span>客服账号</span>
            </span>
            <small>{agents.length}</small>
          </button>
          <button
            type="button"
            className={section === 'statistics' ? 'active' : ''}
            onClick={() => setSection('statistics')}
          >
            <span className="admin-nav-label">
              <UiIcon name="statistics" />
              <span>坐席流量</span>
            </span>
            <small>自然月</small>
          </button>
          <button
            type="button"
            className={section === 'workspace' ? 'active' : ''}
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
            <section className="admin-overview-strip" aria-label="客服概览">
              <div>
                <strong>{agents.length}</strong>
                <span>客服总数</span>
              </div>
              <div>
                <strong>{onlineCount}</strong>
                <span>当前在线</span>
              </div>
              <div>
                <strong>{enabledCount}</strong>
                <span>已启用账号</span>
              </div>
              <div>
                <strong>{assignedProductCount}</strong>
                <span>已覆盖产品</span>
              </div>
            </section>

            <section className="admin-table-card">
              <div className="admin-table-title">
                <div>
                  <strong>客服账号列表</strong>
                  <span>分区和分类规则会自动覆盖后续新增产品</span>
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
                  <table className="admin-table admin-agent-table">
                    <thead>
                      <tr>
                        <th>客服账号</th>
                        <th>负责范围</th>
                        <th>状态</th>
                        <th>接待能力</th>
                        <th>咨询额度</th>
                        <th aria-label="操作" />
                      </tr>
                    </thead>
                    <tbody>
                      {agents.map((agent) => {
                        const summary = agentScopeSummary(agent, products);
                        const dailyFull =
                          agent.dailyConversationLimit > 0 &&
                          agent.todayConversationCount >=
                            agent.dailyConversationLimit;
                        const dailyRemaining = Math.max(
                          0,
                          agent.dailyConversationLimit -
                            agent.todayConversationCount,
                        );
                        return (
                          <tr key={agent.id}>
                            <td>
                              <div className="admin-agent-cell">
                                <span className="admin-agent-avatar">
                                  {initials(agent.name)}
                                </span>
                                <div className="admin-agent-identity">
                                  <strong>{agent.name}</strong>
                                  <small>
                                    @{agent.username || '未设置账号'} ·{' '}
                                    {agent.lastSeenAt
                                      ? `最后在线 ${relativeTime(agent.lastSeenAt)}`
                                      : '从未登录'}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <div
                                className={`agent-scope-summary ${summary.tone}`}
                              >
                                <strong>{summary.title}</strong>
                                <small>{summary.detail}</small>
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
                            <td>
                              <div className="admin-capacity-cell">
                                <strong>
                                  {agent.todayConversationCount}
                                  <span>
                                    {' '}
                                    / {agent.dailyConversationLimit || '∞'} 今日
                                  </span>
                                </strong>
                                <small className={dailyFull ? 'is-full' : ''}>
                                  {dailyFull
                                    ? '今日已达上限'
                                    : `同时 ${
                                        agent.maxActiveConversations || '不限'
                                      } · ${
                                        agent.dailyConversationLimit > 0
                                          ? `今日剩余 ${dailyRemaining}`
                                          : '每日不限'
                                      }`}
                                </small>
                              </div>
                            </td>
                            <td>
                              <div className="traffic-quota-cell">
                                {agent.trafficQuotaEnabled ? (
                                  <>
                                    <strong>
                                      {agent.trafficQuotaRemaining}
                                      <span>
                                        {' '}
                                        / {agent.trafficQuotaTotal} 剩余
                                      </span>
                                    </strong>
                                    <small
                                      className={
                                        agent.trafficQuotaRemaining === 0
                                          ? 'is-full'
                                          : ''
                                      }
                                    >
                                      {agent.trafficQuotaRemaining === 0
                                        ? '额度已用完'
                                        : `已用 ${agent.trafficQuotaUsed}`}
                                    </small>
                                  </>
                                ) : (
                                  <>
                                    <strong>不限</strong>
                                    <small>未启用累计额度</small>
                                  </>
                                )}
                              </div>
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {section === 'statistics' && (
          <AdminStatisticsPage
            agents={agents}
            month={statsMonth}
            stats={monthlyStats}
            busy={statsBusy}
            error={statsError}
            onClearError={() => setStatsError('')}
            onMonthChange={(month) => {
              setStatsBusy(true);
              setStatsMonth(month);
            }}
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
        <AgentEditorModal
          draft={draft}
          products={products}
          saving={saving}
          quotaAdjustments={quotaAdjustments}
          quotaLedger={quotaLedger}
          quotaHistoryBusy={quotaHistoryBusy}
          quotaHistoryError={quotaHistoryError}
          onDraftChange={setDraft}
          onLoadQuotaLedger={() => void loadQuotaLedger()}
          onClose={() => {
            if (!saving) setEditorOpen(false);
          }}
          onSubmit={(event) => void saveAgent(event)}
        />
      )}
    </div>
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