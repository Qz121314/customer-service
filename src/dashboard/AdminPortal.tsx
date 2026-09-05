import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AgentAccount,
  AgentQuotaAdjustment,
  AgentQuotaLedger,
  ProductCatalogItem,
  TrafficOverviewStats,
  NoAgentMessageSettings,
  adminLogin,
  adminLogout,
  createAgent,
  deleteAgent,
  getAdminSession,
  getTrafficOverviewStats,
  getAgentQuotaLedger,
  getAgents,
  getProductCatalog,
  getNoAgentMessage,
  updateAgent,
  updateNoAgentMessage,
} from './api';
import {
  LoadState,
  AgentDraft,
  emptyAgentDraft,
  message,
} from './dashboard-runtime';
import { AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { AdminStatisticsPage } from './AdminStatisticsPage';
import { AgentEditorModal } from './AgentEditorModal';
import { AdminAgentStatisticsModal } from './AdminAgentStatisticsModal';
import { NoAgentMessageSettingsPanel } from './NoAgentMessageSettings';
import { AdminShell, type AdminSection } from './AdminShell';
import {
  AdminAgentsPage,
  type AgentFilter,
} from './AdminAgentsPage';
import {
  trafficRangePeriod,
  type TrafficRange,
} from './traffic-statistics-range';

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
  const [noAgentMessage, setNoAgentMessage] =
    useState<NoAgentMessageSettings | null>(null);
  const [section, setSection] = useState<AdminSection>('agents');
  const [agentSearch, setAgentSearch] = useState('');
  const [agentFilter, setAgentFilter] = useState<AgentFilter>('all');
  const [draft, setDraft] = useState<AgentDraft>(emptyAgentDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
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
    const [nextAgents, nextProducts, nextNoAgentMessage] = await Promise.all([
      getAgents(),
      getProductCatalog(),
      getNoAgentMessage(),
    ]);
    setAgents(nextAgents);
    setProducts(nextProducts);
    setNoAgentMessage(nextNoAgentMessage);
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
      adminLabel: agent.adminLabel,
      username: agent.username ?? '',
      password: '',
      routingScope: agent.routingScope,
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
          adminLabel: draft.adminLabel,
          username: draft.username,
          password: draft.password || undefined,
          routingScope: draft.routingScope,
          dailyConversationLimit: draft.dailyConversationLimit,
          trafficQuotaEnabled: draft.trafficQuotaEnabled,
          trafficQuotaTopUp: draft.trafficQuotaTopUp,
          trafficQuotaRequestId: draft.trafficQuotaRequestId,
          isEnabled: draft.isEnabled,
        });
      } else {
        await createAgent({
          name: draft.name,
          adminLabel: draft.adminLabel,
          username: draft.username,
          password: draft.password,
          routingScope: draft.routingScope,
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

  async function saveNoAgentMessage(settings: NoAgentMessageSettings) {
    setSettingsSaving(true);
    setError('');
    try {
      const nextSettings = await updateNoAgentMessage(settings);
      setNoAgentMessage(nextSettings);
    } catch (reason) {
      setError(message(reason, '保存无客服提示语失败'));
      throw reason;
    } finally {
      setSettingsSaving(false);
    }
  }

  async function removeAgent(agent: Pick<AgentAccount, 'id' | 'name'>) {
    if (deletingAgentId) return;
    const confirmed = window.confirm(
      `确定永久删除客服「${agent.name}」？\n\n仍有进行中的会话时系统会拒绝删除；请先停用账号并处理完会话。历史聊天与统计记录会保留。`,
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
  const sectionTitle =
    section === 'agents'
      ? '客服坐席'
      : section === 'settings'
        ? '访客体验'
        : '流量统计';
  const sectionHint =
    section === 'agents'
      ? '管理登录身份、每日接待上限、咨询额度和产品负责范围。自动分流采用严格轮询。'
      : section === 'settings'
        ? '配置产品无客服可用时返回给访客的提示语。'
        : '按日期范围查看产品带来的首次有效咨询与流量转化分布。';

  return (
    <AdminShell
      section={section}
      agentCount={agents.length}
      title={sectionTitle}
      hint={sectionHint}
      showCreateAgent={section === 'agents'}
      onSectionChange={setSection}
      onLogout={onLogout}
      onCreateAgent={createNewAgent}
      overlays={
        <>
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
        </>
      }
    >
      {error && (
        <button
          type="button"
          className="notice error"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}

      {section === 'settings' && noAgentMessage ? (
        <NoAgentMessageSettingsPanel
          settings={noAgentMessage}
          saving={settingsSaving}
          onSave={saveNoAgentMessage}
        />
      ) : null}

      {section === 'agents' && (
        <AdminAgentsPage
          agents={agents}
          products={products}
          busy={busy}
          agentSearch={agentSearch}
          agentFilter={agentFilter}
          onSearchChange={setAgentSearch}
          onFilterChange={setAgentFilter}
          onClearFilters={() => {
            setAgentSearch('');
            setAgentFilter('all');
          }}
          onCreateAgent={createNewAgent}
          onOpenStatistics={setStatisticsAgent}
          onEditAgent={editAgent}
        />
      )}

      {section === 'statistics' && (
        <AdminStatisticsPage
          agents={agents}
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
    </AdminShell>
  );
}
