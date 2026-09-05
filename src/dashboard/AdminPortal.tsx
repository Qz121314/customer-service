import { useCallback, useEffect, useState } from 'react';
import {
  type AgentAccount,
  type NoAgentMessageSettings,
  type ProductCatalogItem,
  adminLogin,
  adminLogout,
  getAdminSession,
  getAgents,
  getNoAgentMessage,
  getProductCatalog,
  updateNoAgentMessage,
} from './api';
import { LoadState, message } from './dashboard-runtime';
import { AdminLogin, AdminSetup, Startup } from './dashboard-ui';
import { AdminStatisticsPage } from './AdminStatisticsPage';
import { AgentEditorModal } from './AgentEditorModal';
import { AdminAgentStatisticsModal } from './AdminAgentStatisticsModal';
import { NoAgentMessageSettingsPanel } from './NoAgentMessageSettings';
import {
  AdminRoutingDiagnoseDock,
  AdminRoutingDiagnoseTrigger,
} from './AdminRoutingDiagnoseDock';
import { AdminShell, type AdminSection } from './AdminShell';
import { AdminAgentsPage } from './AdminAgentsPage';
import { useAdminAgentsController } from './useAdminAgentsController';
import { useAdminStatisticsController } from './useAdminStatisticsController';

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
  const [busy, setBusy] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [routingDiagnoseOpen, setRoutingDiagnoseOpen] = useState(false);
  const [error, setError] = useState('');

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

  const statisticsController = useAdminStatisticsController(section);
  const agentsController = useAdminAgentsController({
    refresh,
    setError,
    onAgentDeleted: statisticsController.handleAgentDeleted,
  });

  useEffect(() => {
    refresh()
      .catch((reason) => setError(message(reason, '无法加载配置')))
      .finally(() => setBusy(false));
  }, [refresh]);

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
      onCreateAgent={agentsController.pageProps.onCreateAgent}
      actions={
        section === 'agents' ? (
          <AdminRoutingDiagnoseTrigger
            onOpen={() => setRoutingDiagnoseOpen(true)}
          />
        ) : null
      }
      overlays={
        <>
          <AdminRoutingDiagnoseDock
            products={products}
            open={routingDiagnoseOpen}
            onClose={() => setRoutingDiagnoseOpen(false)}
          />
          {agentsController.editorOpen && (
            <AgentEditorModal
              products={products}
              {...agentsController.editorProps}
            />
          )}
          {statisticsController.statisticsAgent && (
            <AdminAgentStatisticsModal
              agent={statisticsController.statisticsAgent}
              onClose={statisticsController.closeAgentStatistics}
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
          {...agentsController.pageProps}
          onOpenStatistics={statisticsController.openAgentStatistics}
        />
      )}

      {section === 'statistics' && (
        <AdminStatisticsPage
          agents={agents}
          products={products}
          {...statisticsController.pageProps}
        />
      )}
    </AdminShell>
  );
}
