import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AgentAccount,
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
  TrafficOverviewStats,
  adminLogin,
  adminLogout,
  createAgent,
  deleteAgent,
  getAdminSession,
  getTrafficOverviewStats,
  getAgentQuotaLedger,
  getAgents,
  getProductCatalog,
  updateAgent,
} from './api';
import {
  LoadState,
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
import { AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { UiIcon } from './icons';
import { AdminStatisticsPage } from './AdminStatisticsPage';
import { AgentEditorModal } from './AgentEditorModal';
import { AdminAgentStatisticsModal } from './AdminAgentStatisticsModal';
import { Button } from './ui';

type AdminView = 'agents' | 'statistics';
type AgentFilter = 'all' | 'online' | 'limited' | 'disabled';
type TrafficRange = 'today' | 'yesterday' | '7d' | '30d' | '90d';

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
  const [agentSearch, setAgentSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [trafficRange, setTrafficRange] = useState<TrafficRange>('today');
  const [trafficStats, setTrafficStats] = useState<TrafficOverviewStats | null>(
    null,
  );
  const [statisticsAgent, setStatisticsAgent] = useState<AgentAccount | null>(
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
  const trafficPeriod = useMemo(
    () => trafficRangePeriod(trafficRange),
    [trafficRange],
  );

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
    getTrafficOverviewStats(trafficPeriod.from, trafficPeriod.to)
      .then((result) => {
        if (active) setTrafficStats(result);
      })
      .catch((reason) => {
        if (active) setStatsError(message(reason, '无法加载流量统计'));
      })
      .finally(() => {
        if (active) setStatsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [section, trafficPeriod.from, trafficPeriod.to]);

  useEffect(() => {
    if (!editorOpen || saving) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditorOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [editorOpen, saving]);

  const onlineCount = agents.filter(
    (agent) => agent.isEnabled && agent.status === 'online',
  ).length;
  const enabledCount = agents.filter((agent) => agent.isEnabled).length;
  const disabledCount = agents.length - enabledCount;
  const limitedCount = agents.filter(agentIsLimited).length;
  const assignedProductCount = new Set(
    agents.flatMap((agent) =>
      productsForScope(agent.routingScope, products).map(
        (product) => product.id,
      ),
    ),
  ).size;

  const visibleAgents = useMemo(() => {
    const keyword = agentSearch.trim().toLocaleLowerCase();
    return agents.filter((agent) => {
      const matchesSearch =
        !keyword ||
        `${agent.name} ${agent.username ?? ''}`
          .toLocaleLowerCase()
          .includes(keyword);
      if (!matchesSearch) return false;

      if (agentFilter === 'online') {
        return agent.isEnabled && agent.status === 'online';
      }
      if (agentFilter === 'limited') return agentIsLimited(agent);
      if (agentFilter === 'disabled') return !agent.isEnabled;
      return true;
    });
  }, [agentFilter, agentSearch, agents]);

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

  async function removeAgent(agent: Pick<AgentAccount, 'id' | 'name'>) {
    if (deletingAgentId) return;
    const confirmed = window.confirm(
      `确定永久删除客服「${agent.name}」？\n\n删除后该账号将立即无法登录，当前未结束会话会释放并重新分配；历史聊天与统计记录会保留。`,
    );
    if (!confirmed) return;

    setDeletingAgentId(agent.id);
    setError('');
    try {
      await deleteAgent(agent.id);
      if (statisticsAgent?.id === agent.id) setStatisticsAgent(null);
      if (draft.id === agent.id) {
        setEditorOpen(false);
        setDraft(emptyAgentDraft);
        resetQuotaLedgerState();
      }
      await refresh();
    } catch (reason) {
      setError(message(reason, '删除客服失败'));
    } finally {
      setDeletingAgentId(null);
    }
  }

  const editingAgentId = draft.id;
  const sectionTitle = section === 'agents' ? '客服坐席' : '流量统计';
  const sectionHint =
    section === 'agents'
      ? '管理登录身份、接待能力、咨询额度和产品负责范围。搜索与筛选均在本地完成。'
      : '按自然月查看产品带来的首次有效咨询与流量转化分布。';

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
              <span>流量统计</span>
            </span>
            <small>自然月</small>
          </button>
        </nav>
        <div className="admin-sidebar-foot">
          <a href="/agent" target="_blank" rel="noreferrer">
            <span>
              <UiIcon name="external" />
              坐席工作台
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
            <Button type="button" onClick={createNewAgent}>
              <UiIcon name="plus" />
              新增客服
            </Button>
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
                  <strong>客服账号</strong>
                  <span>分区和分类规则会自动覆盖后续新增产品</span>
                </div>
                <span className="admin-table-total">
                  {visibleAgents.length === agents.length
                    ? `${agents.length} 个账号`
                    : `显示 ${visibleAgents.length} / ${agents.length}`}
                </span>
              </div>

              <div className="admin-list-toolbar">
                <label className="admin-agent-search">
                  <span>搜索</span>
                  <input
                    type="search"
                    value={agentSearch}
                    onChange={(event) => setAgentSearch(event.target.value)}
                    placeholder="姓名或登录账号"
                    aria-label="搜索客服姓名或登录账号"
                  />
                </label>
                <div className="admin-agent-filters" aria-label="客服状态筛选">
                  {(
                    [
                      ['all', '全部', agents.length],
                      ['online', '在线', onlineCount],
                      ['limited', '受限', limitedCount],
                      ['disabled', '停用', disabledCount],
                    ] as const
                  ).map(([value, label, count]) => (
                    <button
                      type="button"
                      key={value}
                      className={agentFilter === value ? 'active' : ''}
                      aria-pressed={agentFilter === value}
                      onClick={() => setAgentFilter(value)}
                    >
                      <span>{label}</span>
                      <small>{count}</small>
                    </button>
                  ))}
                </div>
              </div>

              {busy ? (
                <div className="empty-state">正在加载客服账号…</div>
              ) : agents.length === 0 ? (
                <div className="empty-state admin-empty">
                  <strong>还没有客服账号</strong>
                  <span>创建第一个客服账号后，再配置它的分流负责范围。</span>
                  <Button type="button" onClick={createNewAgent}>
                    新增客服
                  </Button>
                </div>
              ) : visibleAgents.length === 0 ? (
                <div className="empty-state admin-empty admin-filter-empty">
                  <strong>没有匹配的客服</strong>
                  <span>调整搜索内容或状态筛选即可恢复列表。</span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setAgentSearch('');
                      setAgentFilter('all');
                    }}
                  >
                    清除筛选
                  </Button>
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
                      {visibleAgents.map((agent) => {
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
                              <div className="admin-agent-actions">
                                <button
                                  type="button"
                                  className="table-action statistics-action"
                                  onClick={() => setStatisticsAgent(agent)}
                                >
                                  统计
                                </button>
                                <button
                                  type="button"
                                  className="table-action"
                                  onClick={() => editAgent(agent)}
                                >
                                  编辑
                                </button>
                              </div>
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
            products={products}
            range={trafficRange}
            stats={trafficStats}
            busy={statsBusy}
            error={statsError}
            onClearError={() => setStatsError('')}
            onRangeChange={(range) => {
              setStatsBusy(true);
              setTrafficRange(range);
            }}
          />
        )}
      </main>

      {editorOpen && (
        <AgentEditorModal
          draft={draft}
          products={products}
          saving={saving}
          deleting={
            editingAgentId !== null && deletingAgentId === editingAgentId
          }
          quotaAdjustments={quotaAdjustments}
          quotaLedger={quotaLedger}
          quotaHistoryBusy={quotaHistoryBusy}
          quotaHistoryError={quotaHistoryError}
          onDraftChange={setDraft}
          onLoadQuotaLedger={() => void loadQuotaLedger()}
          onDelete={
            editingAgentId
              ? () =>
                  void removeAgent({
                    id: editingAgentId,
                    name: draft.name,
                  })
              : undefined
          }
          onClose={() => {
            if (!saving && !deletingAgentId) setEditorOpen(false);
          }}
          onSubmit={(event) => void saveAgent(event)}
        />
      )}
      {statisticsAgent && (
        <AdminAgentStatisticsModal
          agent={statisticsAgent}
          onClose={() => setStatisticsAgent(null)}
        />
      )}
    </div>
  );
}

function agentIsLimited(agent: AgentAccount): boolean {
  if (!agent.isEnabled) return false;
  const dailyFull =
    agent.dailyConversationLimit > 0 &&
    agent.todayConversationCount >= agent.dailyConversationLimit;
  const trafficExhausted =
    agent.trafficQuotaEnabled && agent.trafficQuotaRemaining <= 0;
  return dailyFull || trafficExhausted;
}

function currentBusinessDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftBusinessDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function trafficRangePeriod(range: TrafficRange): {
  from: string;
  to: string;
} {
  const today = currentBusinessDate();
  if (range === 'yesterday') {
    const yesterday = shiftBusinessDate(today, -1);
    return { from: yesterday, to: yesterday };
  }
  const days =
    range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 1;
  return { from: shiftBusinessDate(today, -(days - 1)), to: today };
}
