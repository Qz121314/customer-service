import type { ReactNode } from 'react';
import { UiIcon } from './icons';
import { Button } from './ui';

export type AdminSection = 'agents' | 'statistics' | 'settings';

type AdminSidebarProps = {
  section: AdminSection;
  agentCount: number;
  onSectionChange: (section: AdminSection) => void;
  onLogout: () => Promise<void>;
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
    children: ReactNode;
    overlays?: ReactNode;
  };

export function AdminSidebar({
  section,
  agentCount,
  onSectionChange,
  onLogout,
}: AdminSidebarProps) {
  return (
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
          aria-current={section === 'agents' ? 'page' : undefined}
          onClick={() => onSectionChange('agents')}
        >
          <span className="admin-nav-label">
            <UiIcon name="agents" />
            <span>客服账号</span>
          </span>
          <small>{agentCount}</small>
        </button>
        <button
          type="button"
          className={section === 'settings' ? 'active' : ''}
          aria-current={section === 'settings' ? 'page' : undefined}
          onClick={() => onSectionChange('settings')}
        >
          <span className="admin-nav-label">
            <UiIcon name="settings" />
            <span>访客体验</span>
          </span>
        </button>
        <button
          type="button"
          className={section === 'statistics' ? 'active' : ''}
          aria-current={section === 'statistics' ? 'page' : undefined}
          onClick={() => onSectionChange('statistics')}
        >
          <span className="admin-nav-label">
            <UiIcon name="statistics" />
            <span>流量统计</span>
          </span>
          <small>日期</small>
        </button>
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

export function AdminPageHeader({
  title,
  hint,
  showCreateAgent,
  onCreateAgent,
  actions,
}: AdminPageHeaderProps) {
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
  title,
  hint,
  showCreateAgent,
  onSectionChange,
  onLogout,
  onCreateAgent,
  actions,
  children,
  overlays,
}: AdminShellProps) {
  return (
    <div className="admin-console">
      <AdminSidebar
        section={section}
        agentCount={agentCount}
        onSectionChange={onSectionChange}
        onLogout={onLogout}
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
