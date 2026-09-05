import { useMemo } from 'react';
import type {
  AgentAccount,
  ProductCatalogItem,
  TrafficOverviewStats,
} from './api';
import {
  AdminStatisticsDistributionCard,
  AdminStatisticsFooter,
  AdminStatisticsOverviewHeader,
  AdminStatisticsTotalCard,
} from './AdminStatisticsSections';
import type { TrafficRange } from './traffic-statistics-range';

const DISTRIBUTION_COLORS = [
  '#635bdf',
  '#8478f2',
  '#3a9f83',
  '#d89547',
  '#d86c8a',
  '#6f8fc9',
  '#9a7d68',
];

export function AdminStatisticsPage({
  agents,
  products,
  range,
  stats,
  busy,
  error,
  onClearError,
  onRangeChange,
}: {
  agents: Array<Pick<AgentAccount, 'id' | 'adminLabel'>>;
  products: ProductCatalogItem[];
  range: TrafficRange;
  stats: TrafficOverviewStats | null;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onRangeChange: (range: TrafficRange) => void;
}) {
  const agentMarkerMap = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.adminLabel])),
    [agents],
  );
  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );
  const agentRows = stats?.agents ?? [];
  const productRows = (stats?.products ?? []).map((row) => ({
    ...row,
    catalog: row.productId ? productMap.get(row.productId) : null,
  }));
  const total = stats?.total ?? 0;
  const pending = agentRows.find((row) => row.agentId === null)?.count ?? 0;
  const accepted = Math.max(0, total - pending);
  const agentDistributionRows = agentRows.map((row, index) => {
    const agentMarker = row.agentId
      ? agentMarkerMap.get(row.agentId) || '未标记'
      : '待接待';
    return {
      key: row.agentId ?? '__pending__',
      name: agentMarker,
      detail: row.agentId ? '首次接待客服' : '尚未分配客服',
      count: row.count,
      color: row.agentId
        ? DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length]
        : '#d89547',
      marker: row.agentId ? initials(agentMarker) : '待',
      emphasized: Boolean(row.agentId),
      pending: row.agentId === null,
    };
  });
  const productDistributionRows = productRows.map((row, index) => ({
    key: row.productId ?? '__unknown__',
    name: row.catalog?.title || row.productTitle || '未知产品',
    detail:
      row.catalog?.categoryName ||
      row.catalog?.sectionName ||
      (row.productId ? '产品会话' : '未识别产品'),
    count: row.count,
    color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
    marker: (row.catalog?.title || row.productTitle || '未').slice(0, 1),
    imageUrl: row.catalog?.coverUrl ?? null,
  }));

  return (
    <section className="admin-statistics-page">
      {error && (
        <button type="button" className="notice error" onClick={onClearError}>
          {error}
        </button>
      )}

      <section
        className={`traffic-overview${busy ? ' is-loading' : ''}`}
        aria-busy={busy}
      >
        <AdminStatisticsOverviewHeader
          range={range}
          onRangeChange={onRangeChange}
        />

        <div className="traffic-overview-grid">
          <AdminStatisticsTotalCard
            stats={stats}
            busy={busy}
            total={total}
            accepted={accepted}
            pending={pending}
          />

          <AdminStatisticsDistributionCard
            eyebrow="AGENTS"
            title="客服接待分布"
            emptyLabel="暂无客服接待"
            total={total}
            busy={busy}
            rows={agentDistributionRows}
          />

          <AdminStatisticsDistributionCard
            eyebrow="PRODUCTS"
            title="产品会话分布"
            emptyLabel="暂无产品会话"
            total={total}
            busy={busy}
            rows={productDistributionRows}
          />
        </div>

        <AdminStatisticsFooter
          busy={busy}
          agentTotal={sumCounts(agentRows)}
          productTotal={sumCounts(productRows)}
          total={total}
        />
      </section>
    </section>
  );
}

function initials(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 2).toUpperCase() : '客';
}

function sumCounts(rows: Array<{ count: number }>): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}
