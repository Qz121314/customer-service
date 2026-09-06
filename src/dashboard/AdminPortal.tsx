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
import { SiteSettingsPage } from './SiteSettingsPage';
import { AdminRoutingDiagnoseWorkspace } from './AdminRoutingDiagnoseDock';
import {
  AdminShell,
  type AdminContextNavigation,
  type AdminSection,
} from './AdminShell';
import { AdminAgentsPage } from './AdminAgentsPage';
import { getSiteLogo, type SiteLogoInfo } from './site-logo-client';
import { useAdminAgentsController } from './useAdminAgentsController';
import { useAdminStatisticsController } from './useAdminStatisticsController';

type AgentsView = 'accounts' | 'diagnostics';
type SettingsView = 'branding' | 'availability' | 'promotion';

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
  const [siteLogo, setSiteLogo] = useState<SiteLogoInfo | null>(null);
  const [section, setSection] = useState<AdminSection>('dashboard');
  const [agentsView, setAgentsView] = useState<AgentsView>('accounts');
  const [settingsView, setSettingsView] = useState<SettingsView>('branding');
  const [busy, setBusy] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
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
    getSiteLogo()
      .then(setSiteLogo)
      .catch((reason) => setError(message(reason, '无法加载站点 Logo')));
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

  function changeSection(nextSection: AdminSection) {
    if (nextSection === 'agents') setAgentsView('accounts');
    if (nextSection === 'settings') setSettingsView('branding');
    setSection(nextSection);
  }

  const contextNavigation: AdminContextNavigation | null =
    section === 'agents'
      ? {
          title: '客服坐席',
          description: '账号管理与分流检查',
          items: [
            {
              id: 'accounts',
              label: '客服账号',
              description: '账号、状态、额度与负责范围',
              active: agentsView === 'accounts',
              onSelect: () => setAgentsView('accounts'),
            },
            {
              id: 'diagnostics',
              label: '分流诊断',
              description: '只读检查严格轮询资格',
              active: agentsView === 'diagnostics',
              onSelect: () => setAgentsView('diagnostics'),
            },
          ],
        }
      : section === 'settings'
        ? {
            title: '站点设置',
            description: '品牌与访客侧体验',
            items: [
              {
                id: 'branding',
                label: '品牌',
                description: '站点 Logo 与默认品牌标记',
                active: settingsView === 'branding',
                onSelect: () => setSettingsView('branding'),
              },
              {
                id: 'availability',
                label: '客服可用性',
                description: '无可分配客服时的访客响应',
                active: settingsView === 'availability',
                onSelect: () => setSettingsView('availability'),
              },
              {
                id: 'promotion',
                label: '访客推广',
                description: 'Messages 置顶推广与文章内容',
                active: settingsView === 'promotion',
                onSelect: () => setSettingsView('promotion'),
              },
            ],
          }
        : null;

  const sectionTitle =
    section === 'dashboard'
      ? '仪表板'
      : section === 'agents'
        ? agentsView === 'accounts'
          ? '客服账号'
          : '分流诊断'
        : settingsView === 'branding'
          ? '品牌'
          : settingsView === 'availability'
            ? '客服可用性'
            : '访客推广';
  const sectionHint =
    section === 'dashboard'
      ? '客服系统运营概览：快速查看咨询总量、客服接待与产品会话分布。'
      : section === 'agents'
        ? agentsView === 'accounts'
          ? '查找客服并管理登录身份、接待上限、咨询额度和产品负责范围。'
          : '按产品只读检查当前严格轮询资格、排除原因和下一棒。'
        : settingsView === 'branding'
          ? '管理管理员后台使用的站点 Logo；未配置时继续显示默认 CS。'
          : settingsView === 'availability'
            ? '管理没有可分配客服时，访客立即看到的提示内容。'
            : '管理 Visitor Messages 顶部的独立 Promotion Article；不影响聊天未读或会话统计。';

  return (
    <AdminShell
      section={section}
      agentCount={agents.length}
      siteLogo={siteLogo}
      title={sectionTitle}
      hint={sectionHint}
      showCreateAgent={section === 'agents' && agentsView === 'accounts'}
      contextNavigation={contextNavigation}
      onSectionChange={changeSection}
      onLogout={onLogout}
      onCreateAgent={agentsController.pageProps.onCreateAgent}
      overlays={
        <>
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

      {section === 'dashboard' && (
        <AdminStatisticsPage
          agents={agents}
          products={products}
          {...statisticsController.pageProps}
        />
      )}

      {section === 'agents' && agentsView === 'accounts' && (
        <AdminAgentsPage
          agents={agents}
          products={products}
          busy={busy}
          {...agentsController.pageProps}
          onOpenStatistics={statisticsController.openAgentStatistics}
        />
      )}

      {section === 'agents' && agentsView === 'diagnostics' && (
        <AdminRoutingDiagnoseWorkspace products={products} />
      )}

      {section === 'settings' && noAgentMessage ? (
        <SiteSettingsPage
          view={settingsView}
          noAgentMessage={noAgentMessage}
          noAgentSaving={settingsSaving}
          siteLogo={siteLogo}
          onSiteLogoChange={setSiteLogo}
          onSaveNoAgentMessage={saveNoAgentMessage}
        />
      ) : null}
    </AdminShell>
  );
}
