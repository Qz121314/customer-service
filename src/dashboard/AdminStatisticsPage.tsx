import { useMemo, type CSSProperties } from 'react';
import type {
  AgentAccount,
  ProductCatalogItem,
  TrafficOverviewStats,
} from './api';
import { TrafficDateRangePicker } from './TrafficDateRangePicker';
import {
  customTrafficRange,
  parseCustomTrafficRange,
  type TrafficRange,
  type TrafficRangePreset,
} from './traffic-statistics-range';

const RANGE_OPTIONS: Array<{ value: TrafficRangePreset; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'yesterday', label: '昨日' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

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
  const customRange = parseCustomTrafficRange(range);

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
        <header className="traffic-overview-toolbar">
          <div>
            <span>CONVERSATION FLOW</span>
            <strong>会话流量分布</strong>
            <small>
              总量、客服和产品使用同一批会话数据，结果始终能够对账。
            </small>
          </div>
          <div className="traffic-range-controls">
            <div
              className="traffic-range-switcher"
              role="group"
              aria-label="统计快捷时间范围"
            >
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={range === option.value ? 'is-active' : ''}
                  aria-pressed={range === option.value}
                  onClick={() => onRangeChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <TrafficDateRangePicker
              value={customRange}
              onApply={(from, to) =>
                onRangeChange(customTrafficRange(from, to))
              }
            />
          </div>
        </header>

        <div className="traffic-overview-grid">
          <article className="traffic-total-card">
            <div className="traffic-card-label">
              <span>TOTAL</span>
              <strong>会话总数</strong>
            </div>
            <div className="traffic-total-value">
              <strong>{busy ? '—' : total.toLocaleString('zh-CN')}</strong>
              <span>个前端会话</span>
            </div>
            <div className="traffic-total-breakdown">
              <div>
                <span>已接待</span>
                <strong>{busy ? '—' : accepted}</strong>
              </div>
              <div className={pending ? 'has-pending' : ''}>
                <span>待接待</span>
                <strong>{busy ? '—' : pending}</strong>
              </div>
            </div>
            <div className="traffic-total-period">
              <span>统计区间</span>
              <strong>
                {stats ? formatPeriod(stats.from, stats.to) : '正在读取…'}
              </strong>
            </div>
            <div className="traffic-total-visual" aria-hidden="true">
              {[42, 68, 52, 82, 63, 94, 72].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          </article>

          <DistributionCard
            eyebrow="AGENTS"
            title="客服接待分布"
            emptyLabel="暂无客服接待"
            total={total}
            busy={busy}
            rows={agentRows.map((row, index) => {
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
            })}
          />

          <DistributionCard
            eyebrow="PRODUCTS"
            title="产品会话分布"
            emptyLabel="暂无产品会话"
            total={total}
            busy={busy}
            rows={productRows.map((row, index) => ({
              key: row.productId ?? '__unknown__',
              name: row.catalog?.title || row.productTitle || '未知产品',
              detail:
                row.catalog?.categoryName ||
                row.catalog?.sectionName ||
                (row.productId ? '产品会话' : '未识别产品'),
              count: row.count,
              color: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
              marker: (row.catalog?.title || row.productTitle || '未').slice(
                0,
                1,
              ),
              imageUrl: row.catalog?.coverUrl ?? null,
            }))}
          />
        </div>

        <footer className="traffic-overview-foot">
          <span>数据按 America/Los_Angeles 自然日统计，保留 90 天。</span>
          <strong>
            {busy
              ? '正在核对分布…'
              : `客服分布 ${sumCounts(agentRows)} / 产品分布 ${sumCounts(
                  productRows,
                )} / 总量 ${total}`}
          </strong>
        </footer>
      </section>
    </section>
  );
}

function DistributionCard({
  eyebrow,
  title,
  emptyLabel,
  total,
  busy,
  rows,
}: {
  eyebrow: string;
  title: string;
  emptyLabel: string;
  total: number;
  busy: boolean;
  rows: Array<{
    key: string;
    name: string;
    detail: string;
    count: number;
    color: string;
    marker: string;
    pending?: boolean;
    emphasized?: boolean;
    imageUrl?: string | null;
  }>;
}) {
  return (
    <article className="traffic-distribution-card">
      <header>
        <div className="traffic-card-label">
          <span>{eyebrow}</span>
          <strong>{title}</strong>
        </div>
        <small>{rows.length} 项</small>
      </header>
      <div className="traffic-distribution-list">
        {rows.length ? (
          rows.map((row) => {
            const share = total ? (row.count / total) * 100 : 0;
            return (
              <div
                className={`traffic-distribution-row${
                  row.pending ? ' is-pending' : ''
                }`}
                key={row.key}
              >
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt="" />
                ) : (
                  <span
                    className="traffic-row-marker"
                    style={{ '--marker-color': row.color } as CSSProperties}
                  >
                    {row.marker}
                  </span>
                )}
                <div className="traffic-row-copy">
                  <strong
                    className={row.emphasized ? 'traffic-agent-marker' : ''}
                    title={row.name}
                  >
                    {row.name}
                  </strong>
                  <small>{row.detail}</small>
                  <div className="traffic-row-meter">
                    <i
                      style={{
                        width: `${Math.max(share ? 2 : 0, share)}%`,
                        background: row.color,
                      }}
                    />
                  </div>
                </div>
                <div className="traffic-row-value">
                  <strong>{busy ? '—' : row.count}</strong>
                  <small>{busy ? '—' : formatShare(row.count, total)}</small>
                </div>
              </div>
            );
          })
        ) : (
          <div className="traffic-distribution-empty">
            <span>—</span>
            <strong>{busy ? '正在读取' : emptyLabel}</strong>
            <small>产生新会话后会自动形成分布</small>
          </div>
        )}
      </div>
    </article>
  );
}

function initials(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 2).toUpperCase() : '客';
}

function formatShare(value: number, total: number): string {
  if (!total) return '0.0%';
  return `${((value / total) * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function sumCounts(rows: Array<{ count: number }>): number {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function formatPeriod(from: string, to: string): string {
  if (from === to) return from;
  return `${from} — ${to}`;
}
