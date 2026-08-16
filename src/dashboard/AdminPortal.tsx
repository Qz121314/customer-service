import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  AgentAccount,
  AgentQuotaAdjustment,
  AgentMonthlyStats,
  ProductCatalogItem,
  adminLogin,
  adminLogout,
  createAgent,
  getAdminSession,
  getAgentMonthlyStats,
  getAgentQuotaAdjustments,
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
  message,
} from './dashboard-runtime';
import { UiIcon, AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { AdminStatisticsModal } from './AdminStatisticsModal';
import { AgentEditorModal } from './AgentEditorModal';

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
  const [quotaAdjustments, setQuotaAdjustments] = useState<
    AgentQuotaAdjustment[]
  >([]);
  const [quotaHistoryBusy, setQuotaHistoryBusy] = useState(false);

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
        if (active) setStatsError(message(reason, '无法加载坐席流量'));
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

  useEffect(() => {
    if (!editorOpen || !draft.id) {
      setQuotaAdjustments([]);
      setQuotaHistoryBusy(false);
      return;
    }
    let active = true;
    setQuotaHistoryBusy(true);
    getAgentQuotaAdjustments(draft.id)
      .then((adjustments) => {
        if (active) setQuotaAdjustments(adjustments);
      })
      .catch((reason) => {
        if (active) setError(message(reason, '无法读取额度变更'));
      })
      .finally(() => {
        if (active) setQuotaHistoryBusy(false);
      });
    return () => {
      active = false;
    };
  }, [editorOpen, draft.id]);

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
    setDraft({
      ...emptyAgentDraft,
      trafficQuotaRequestId: crypto.randomUUID(),
    });
    setQuotaAdjustments([]);
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
              <span>坐席流量</span>
            </span>
            <small>自然月</small>
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
                        <th>额度余额</th>
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
                            <div className="traffic-quota-cell">
                              {agent.trafficQuotaEnabled ? (
                                <>
                                  <strong>
                                    {agent.trafficQuotaRemaining}
                                    <span> / {agent.trafficQuotaTotal}</span>
                                  </strong>
                                  <span
                                    className={`quota-state ${
                                      agent.trafficQuotaRemaining === 0
                                        ? 'full'
                                        : ''
                                    }`}
                                  >
                                    {agent.trafficQuotaRemaining === 0
                                      ? '额度已用完'
                                      : `已用 ${agent.trafficQuotaUsed}`}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <strong>不限</strong>
                                  <span className="quota-state">
                                    未启用额度
                                  </span>
                                </>
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
        <AdminStatisticsModal
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
          onClose={() => setStatisticsOpen(false)}
        />
      )}

      {editorOpen && (
        <AgentEditorModal
          draft={draft}
          products={products}
          saving={saving}
          quotaAdjustments={quotaAdjustments}
          quotaHistoryBusy={quotaHistoryBusy}
          onDraftChange={setDraft}
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
