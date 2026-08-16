import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
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
  UiIcon,
  emptyAgentDraft,
  CHAT_TIME_ZONE,
  productsForScope,
  agentScopeSummary,
  AdminLogin,
  AdminSetup,
  Startup,
  presenceClass,
  statusLabel,
  initials,
  relativeTime,
  message,
} from './dashboard-shared';
import { ProductAssignmentPicker } from './ProductAssignmentPicker';
import { calendarMonthPeriod } from '../shared/calendar-month';

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
                <span className="eyebrow">流量账本</span>
                <h2 id="admin-statistics-title">坐席接待流量</h2>
                <p>
                  按客服查看首次实际接收的访客流量，转接和重新排队不重复计数。
                </p>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="关闭坐席流量"
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
                      <strong>账号、接待与流量额度</strong>
                      <small>登录身份、并发、每日上限与总额度</small>
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
                  <section className="traffic-quota-editor">
                    <div className="traffic-quota-editor-head">
                      <div>
                        <strong>接待额度套餐</strong>
                        <small>按有效咨询扣减，用完停止新分流</small>
                      </div>
                      <label className="switch-control">
                        <input
                          type="checkbox"
                          checked={draft.trafficQuotaEnabled}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              trafficQuotaEnabled: event.target.checked,
                            })
                          }
                        />
                        <span aria-hidden="true" />
                      </label>
                    </div>
                    <div className="traffic-quota-summary">
                      <div>
                        <span>保存后总额度</span>
                        <strong>
                          {draft.trafficQuotaTotal + draft.trafficQuotaTopUp}
                        </strong>
                      </div>
                      <div>
                        <span>已消耗</span>
                        <strong>{draft.trafficQuotaUsed}</strong>
                      </div>
                      <div>
                        <span>保存后剩余</span>
                        <strong>
                          {Math.max(
                            0,
                            draft.trafficQuotaTotal +
                              draft.trafficQuotaTopUp -
                              draft.trafficQuotaUsed,
                          )}
                        </strong>
                      </div>
                    </div>
                    <div className="traffic-quota-topup">
                      <span>{draft.id ? '本次追加' : '初始额度'}</span>
                      <div className="traffic-quota-presets">
                        {[100, 500, 1000].map((amount) => (
                          <button
                            type="button"
                            key={amount}
                            className={
                              draft.trafficQuotaTopUp === amount
                                ? 'is-active'
                                : ''
                            }
                            onClick={() =>
                              setDraft({
                                ...draft,
                                trafficQuotaTopUp: amount,
                              })
                            }
                          >
                            +{amount}
                          </button>
                        ))}
                        <label>
                          <span>自定义</span>
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            step="1"
                            value={draft.trafficQuotaTopUp}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                trafficQuotaTopUp: Math.max(
                                  0,
                                  Math.min(
                                    1_000_000,
                                    Math.trunc(Number(event.target.value) || 0),
                                  ),
                                ),
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                    <p>
                      追加额度只累加，不清零已消耗；保存失败后重试不会重复增加额度。
                    </p>
                    {draft.id ? (
                      <div className="traffic-quota-history">
                        <div className="traffic-quota-history-head">
                          <strong>最近额度变更</strong>
                          <span>打开编辑时读取</span>
                        </div>
                        {quotaHistoryBusy ? (
                          <p>正在读取…</p>
                        ) : quotaAdjustments.length ? (
                          <div className="traffic-quota-history-list">
                            {quotaAdjustments.map((adjustment) => (
                              <div
                                className="traffic-quota-history-row"
                                key={adjustment.id}
                              >
                                <strong>+{adjustment.amount}</strong>
                                <span>
                                  {adjustment.quotaTotalBefore} →{' '}
                                  {adjustment.quotaTotalAfter}
                                </span>
                                <time>
                                  {relativeTime(
                                    adjustment.appliedAt ??
                                      adjustment.createdAt,
                                  )}
                                </time>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>暂无追加记录</p>
                        )}
                      </div>
                    ) : null}
                  </section>
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
    stats?.month === month ? stats.days : calendarMonthPeriod(month).days;
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
  const selectedHandoffCount = selectedAgent
    ? ((stats?.handoffCounts ?? []).find(
        (item) => item.agentId === selectedAgent.id,
      )?.count ?? 0)
    : 0;
  const selectedCoverage = selectedTotal
    ? `${Math.min(100, (selectedHandoffCount / selectedTotal) * 100).toFixed(1)}%`
    : '0%';

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
          <strong>按坐席核对流量</strong>
          <span>选择客服坐席，查看每天首次实际接收的访客流量</span>
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
                <span>可逐笔对账</span>
                <strong>{busy ? '—' : selectedHandoffCount}</strong>
              </div>
              <div>
                <span>对账覆盖率</span>
                <strong>{busy ? '—' : selectedCoverage}</strong>
              </div>
            </div>

            <div className="statistics-day-section">
              <header>
                <div>
                  <strong>每日接待流量</strong>
                  <span>每个访客会话只在首次进入坐席时计 1 次</span>
                </div>
                <small>完整月份 · {days.length} 天</small>
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
        每日上限按 America/Los_Angeles 自然日计算；流量账本独立于 24
        小时聊天记录保存并保留 400 天。每个统计周期对应一个完整自然月，自动展示
        28、29、30 或 31 天。“可逐笔对账”表示同时带有 Site
        分发编号的流量；旧数据和直接调用客服 API
        的会话仍计入接待总数，但不计入对账覆盖率。
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
