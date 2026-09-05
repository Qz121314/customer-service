import { useMemo } from 'react';
import type { AgentAccount, ProductCatalogItem } from './api';
import {
  agentScopeSummary,
  initials,
  presenceClass,
  productsForScope,
  relativeTime,
  statusLabel,
} from './dashboard-runtime';
import { Button } from './ui';

export type AgentFilter = 'all' | 'online' | 'limited' | 'disabled';

type AdminAgentsPageProps = {
  agents: AgentAccount[];
  products: ProductCatalogItem[];
  busy: boolean;
  agentSearch: string;
  agentFilter: AgentFilter;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: AgentFilter) => void;
  onClearFilters: () => void;
  onCreateAgent: () => void;
  onOpenStatistics: (agent: AgentAccount) => void;
  onEditAgent: (agent: AgentAccount) => void;
};

type AgentOverviewProps = {
  agentCount: number;
  onlineCount: number;
  enabledCount: number;
  assignedProductCount: number;
};

type AgentToolbarProps = {
  agentSearch: string;
  agentFilter: AgentFilter;
  agentCount: number;
  onlineCount: number;
  limitedCount: number;
  disabledCount: number;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: AgentFilter) => void;
};

type AgentTableProps = AgentToolbarProps & {
  agents: AgentAccount[];
  visibleAgents: AgentAccount[];
  products: ProductCatalogItem[];
  busy: boolean;
  onClearFilters: () => void;
  onCreateAgent: () => void;
  onOpenStatistics: (agent: AgentAccount) => void;
  onEditAgent: (agent: AgentAccount) => void;
};

type AgentRowProps = {
  agent: AgentAccount;
  products: ProductCatalogItem[];
  onOpenStatistics: (agent: AgentAccount) => void;
  onEditAgent: (agent: AgentAccount) => void;
};

export function AdminAgentsPage({
  agents,
  products,
  busy,
  agentSearch,
  agentFilter,
  onSearchChange,
  onFilterChange,
  onClearFilters,
  onCreateAgent,
  onOpenStatistics,
  onEditAgent,
}: AdminAgentsPageProps) {
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
        `${agent.name} ${agent.username ?? ''} ${agent.adminLabel}`
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

  return (
    <div className="admin-agent-layout">
      <AgentOverview
        agentCount={agents.length}
        onlineCount={onlineCount}
        enabledCount={enabledCount}
        assignedProductCount={assignedProductCount}
      />
      <AgentTable
        agents={agents}
        visibleAgents={visibleAgents}
        products={products}
        busy={busy}
        agentSearch={agentSearch}
        agentFilter={agentFilter}
        agentCount={agents.length}
        onlineCount={onlineCount}
        limitedCount={limitedCount}
        disabledCount={disabledCount}
        onSearchChange={onSearchChange}
        onFilterChange={onFilterChange}
        onClearFilters={onClearFilters}
        onCreateAgent={onCreateAgent}
        onOpenStatistics={onOpenStatistics}
        onEditAgent={onEditAgent}
      />
    </div>
  );
}

function AgentOverview({
  agentCount,
  onlineCount,
  enabledCount,
  assignedProductCount,
}: AgentOverviewProps) {
  const metrics = [
    ['客服总数', agentCount, ''],
    ['当前在线', onlineCount, 'is-online'],
    ['已启用账号', enabledCount, ''],
    ['已覆盖产品', assignedProductCount, ''],
  ] as const;

  return (
    <section className="admin-overview-strip" aria-label="客服概览">
      {metrics.map(([label, value, tone]) => (
        <div className="admin-overview-metric" key={label}>
          <span className={`admin-overview-label ${tone}`}>
            {tone ? <i aria-hidden="true" /> : null}
            {label}
          </span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function AgentToolbar({
  agentSearch,
  agentFilter,
  agentCount,
  onlineCount,
  limitedCount,
  disabledCount,
  onSearchChange,
  onFilterChange,
}: AgentToolbarProps) {
  return (
    <div className="admin-list-toolbar">
      <label className="admin-agent-search">
        <span>搜索</span>
        <input
          type="search"
          value={agentSearch}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="姓名、账号或标签"
          aria-label="搜索客服姓名、登录账号或标签"
        />
      </label>
      <div className="admin-agent-filters" aria-label="客服状态筛选">
        {(
          [
            ['all', '全部', agentCount],
            ['online', '在线', onlineCount],
            ['limited', '额度不足', limitedCount],
            ['disabled', '停用', disabledCount],
          ] as const
        ).map(([value, label, count]) => (
          <button
            type="button"
            key={value}
            className={agentFilter === value ? 'active' : ''}
            aria-pressed={agentFilter === value}
            onClick={() => onFilterChange(value)}
          >
            <span>{label}</span>
            <small>{count}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentTable({
  agents,
  visibleAgents,
  products,
  busy,
  agentSearch,
  agentFilter,
  agentCount,
  onlineCount,
  limitedCount,
  disabledCount,
  onSearchChange,
  onFilterChange,
  onClearFilters,
  onCreateAgent,
  onOpenStatistics,
  onEditAgent,
}: AgentTableProps) {
  return (
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

      <AgentToolbar
        agentSearch={agentSearch}
        agentFilter={agentFilter}
        agentCount={agentCount}
        onlineCount={onlineCount}
        limitedCount={limitedCount}
        disabledCount={disabledCount}
        onSearchChange={onSearchChange}
        onFilterChange={onFilterChange}
      />

      {busy ? (
        <div className="empty-state">正在加载客服账号…</div>
      ) : agents.length === 0 ? (
        <div className="empty-state admin-empty">
          <strong>还没有客服账号</strong>
          <span>创建第一个客服账号后，再配置它的分流负责范围。</span>
          <Button type="button" onClick={onCreateAgent}>
            新增客服
          </Button>
        </div>
      ) : visibleAgents.length === 0 ? (
        <div className="empty-state admin-empty admin-filter-empty">
          <strong>没有匹配的客服</strong>
          <span>调整搜索内容或状态筛选即可恢复列表。</span>
          <Button type="button" variant="secondary" onClick={onClearFilters}>
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
                <th>今日接待</th>
                <th>咨询额度</th>
                <th aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {visibleAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  products={products}
                  onOpenStatistics={onOpenStatistics}
                  onEditAgent={onEditAgent}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AgentRow({
  agent,
  products,
  onOpenStatistics,
  onEditAgent,
}: AgentRowProps) {
  const summary = agentScopeSummary(agent, products);
  const dailyFull =
    agent.dailyConversationLimit > 0 &&
    agent.todayConversationCount >= agent.dailyConversationLimit;
  const dailyRemaining = Math.max(
    0,
    agent.dailyConversationLimit - agent.todayConversationCount,
  );

  return (
    <tr
      className={
        !agent.isEnabled
          ? 'is-disabled'
          : agentIsLimited(agent)
            ? 'is-limited'
            : undefined
      }
    >
      <td>
        <div className="admin-agent-cell">
          <span className="admin-agent-avatar">{initials(agent.name)}</span>
          <div className="admin-agent-identity">
            <div className="admin-agent-name-line">
              <strong>{agent.name}</strong>
              {agent.adminLabel ? (
                <span className="admin-agent-label">{agent.adminLabel}</span>
              ) : null}
            </div>
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
        <div className={`agent-scope-summary ${summary.tone}`}>
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </div>
      </td>
      <td>
        <span className={`account-status ${presenceClass(agent)}`}>
          {agent.isEnabled ? statusLabel(agent.status) : '已停用'}
        </span>
      </td>
      <td>
        <div className="admin-capacity-cell">
          <strong>
            {agent.todayConversationCount}
            <span> / {agent.dailyConversationLimit || '∞'} 今日</span>
          </strong>
          <small className={dailyFull ? 'is-full' : ''}>
            {dailyFull
              ? '已达每日接待上限，暂停新分流'
              : agent.dailyConversationLimit > 0
                ? `今日剩余 ${dailyRemaining}`
                : '每日不限'}
          </small>
        </div>
      </td>
      <td>
        <div className="traffic-quota-cell">
          {agent.trafficQuotaEnabled ? (
            <>
              <strong>
                {agent.trafficQuotaRemaining}
                <span> / {agent.trafficQuotaTotal} 剩余</span>
              </strong>
              <small
                className={agent.trafficQuotaRemaining === 0 ? 'is-full' : ''}
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
            onClick={() => onOpenStatistics(agent)}
          >
            统计
          </button>
          <button
            type="button"
            className="table-action"
            onClick={() => onEditAgent(agent)}
          >
            编辑
          </button>
        </div>
      </td>
    </tr>
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
