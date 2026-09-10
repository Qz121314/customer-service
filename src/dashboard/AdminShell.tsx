import { useEffect, useState, type ReactNode } from 'react';
import { UiIcon } from './icons';
import type { SiteLogoInfo } from './site-logo-client';
import { Button } from './ui';

export type AdminSection = 'dashboard' | 'agents' | 'settings';

export type AdminContextNavigation = {
  title: string;
  description: string;
  items: Array<{
    id: string;
    label: string;
    description: string;
    active: boolean;
    onSelect: () => void;
  }>;
};

type AdminSidebarProps = {
  section: AdminSection;
  agentCount: number;
  siteLogo: SiteLogoInfo | null;
  contextNavigation?: AdminContextNavigation | null;
  onSectionChange: (section: AdminSection) => void;
  onLogout: () => Promise<void>;
  onOpenBranding: () => void;
};

type AdminPageHeaderProps = {
  title: string;
  hint: string;
  showCreateAgent: boolean;
  onCreateAgent: () => void;
  actions?: ReactNode;
};

type AdminShellProps = AdminSidebarProps &
  AdminPageHeaderProps & {
    contextNavigation?: AdminContextNavigation | null;
    onOpenBranding: () => void;
    children: ReactNode;
    overlays?: ReactNode;
  };

function AdminBrandMark({ siteLogo }: { siteLogo: SiteLogoInfo | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [siteLogo?.url]);

  return (
    <span className="admin-brand-mark" aria-label="站点 Logo">
      <b aria-hidden="true">CS</b>
      {siteLogo && !failed ? (
        <img
          key={siteLogo.url}
          src={siteLogo.url}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

export function AdminSidebar({
  section,
  agentCount,
  siteLogo,
  contextNavigation,
  onSectionChange,
  onLogout,
  onOpenBranding,
}: AdminSidebarProps) {
  return (
    <aside className="admin-sidebar">
      <button
        type="button"
        className="admin-brand admin-brand-button"
        aria-label="上传品牌 Logo"
        onClick={onOpenBranding}
      >
        <AdminBrandMark siteLogo={siteLogo} />
        <div>
          <strong>客服管理</strong>
          <small>管理员后台</small>
        </div>
      </button>
      <nav
        className={`admin-nav${contextNavigation ? ' has-context-navigation' : ''}`}
        aria-label="客服管理导航"
      >
        <button
          type="button"
          className={section === 'dashboard' ? 'active' : ''}
          aria-current={section === 'dashboard' ? 'page' : undefined}
          onClick={() => onSectionChange('dashboard')}
        >
          <span className="admin-nav-label">
            <UiIcon name="dashboard" />
            <span>仪表板</span>
          </span>
        </button>
        <div className="admin-nav-group">
          <button
            type="button"
            className={section === 'agents' ? 'active' : ''}
            aria-current={section === 'agents' ? 'page' : undefined}
            onClick={() => onSectionChange('agents')}
          >
            <span className="admin-nav-label">
              <UiIcon name="agents" />
              <span>客服坐席</span>
            </span>
            <small>{agentCount}</small>
          </button>
          {section === 'agents' && contextNavigation ? (
            <AdminContextNav navigation={contextNavigation} />
          ) : null}
        </div>
        <div className="admin-nav-group">
          <button
            type="button"
            className={section === 'settings' ? 'active' : ''}
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={() => onSectionChange('settings')}
          >
            <span className="admin-nav-label">
              <UiIcon name="settings" />
              <span>站点设置</span>
            </span>
          </button>
          {section === 'settings' && contextNavigation ? (
            <AdminContextNav navigation={contextNavigation} />
          ) : null}
        </div>
      </nav>
      <div className="admin-sidebar-foot">
        <a href="/agent" target="_blank" rel="noreferrer">
          <span>
            <UiIcon name="external" />
            <span className="admin-sidebar-foot-label">坐席工作台</span>
          </span>
        </a>
        <button type="button" onClick={() => void onLogout()}>
          <span>
            <UiIcon name="logout" />
            <span className="admin-sidebar-foot-label">退出管理</span>
          </span>
        </button>
      </div>
    </aside>
  );
}

export function AdminContextNav({
  navigation,
}: {
  navigation: AdminContextNavigation;
}) {
  return (
    <aside className="admin-context-navigation">
      <nav aria-label={`${navigation.title}二级导航`}>
        {navigation.items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.active ? 'active' : ''}
            aria-current={item.active ? 'page' : undefined}
            onClick={item.onSelect}
          >
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

export function AdminPageHeader({
  title,
  hint,
  showCreateAgent,
  onCreateAgent,
  actions,
}: AdminPageHeaderProps) {
  if (!title && !hint && !showCreateAgent && !actions) return null;

  return (
    <header className="admin-content-head">
      <div>
        <h1>{title}</h1>
        <p>{hint}</p>
      </div>
      {actions}
      {showCreateAgent && (
        <Button type="button" onClick={onCreateAgent}>
          <UiIcon name="plus" />
          新增客服
        </Button>
      )}
    </header>
  );
}

export function AdminShell({
  section,
  agentCount,
  siteLogo,
  title,
  hint,
  showCreateAgent,
  contextNavigation,
  onSectionChange,
  onLogout,
  onCreateAgent,
  onOpenBranding,
  actions,
  children,
  overlays,
}: AdminShellProps) {
  return (
    <div className="admin-console">
      <AdminSidebar
        section={section}
        agentCount={agentCount}
        siteLogo={siteLogo}
        contextNavigation={contextNavigation}
        onSectionChange={onSectionChange}
        onLogout={onLogout}
        onOpenBranding={onOpenBranding}
      />
      <main className="admin-content">
        <AdminPageHeader
          title={title}
          hint={hint}
          showCreateAgent={showCreateAgent}
          onCreateAgent={onCreateAgent}
          actions={actions}
        />
        {children}
      </main>
      {overlays}
    </div>
  );
}
