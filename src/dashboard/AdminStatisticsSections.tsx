import type { CSSProperties } from 'react';
import type { TrafficOverviewStats } from './api';
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

const TOTAL_PERIOD_BADGE_STYLE: CSSProperties = {
  top: 18,
  right: 18,
  bottom: 'auto',
  left: 'auto',
  minWidth: 116,
  padding: '7px 10px',
  border: '1px solid rgb(255 255 255 / 12%)',
  borderRadius: 11,
  background: 'rgb(255 255 255 / 8%)',
  alignItems: 'flex-end',
  flexDirection: 'column',
  gap: 2,
  backdropFilter: 'blur(12px)',
};

const TOTAL_PERIOD_LABEL_STYLE: CSSProperties = {
  color: 'rgb(255 255 255 / 58%)',
  fontSize: 8,
  fontWeight: 690,
};

const TOTAL_PERIOD_VALUE_STYLE: CSSProperties = {
  maxWidth: 180,
  color: '#fff',
  fontSize: 10,
  fontWeight: 780,
  lineHeight: 1.2,
  textAlign: 'right',
};

const TOTAL_BREAKDOWN_STYLE: CSSProperties = {
  bottom: 18,
};

export type AdminStatisticsDistributionRow = {
  key: string;
  name: string;
  detail: string;
  count: number;
  color: string;
  marker: string;
  pending?: boolean;
  emphasized?: boolean;
  imageUrl?: string | null;
};

export function AdminStatisticsOverviewHeader({
  range,
  onRangeChange,
}: {
  range: TrafficRange;
  onRangeChange: (range: TrafficRange) => void;
}) {
  const customRange = parseCustomTrafficRange(range);

  return (
    <header className="traffic-overview-toolbar">
      <div>
        <span>CONVERSATION FLOW</span>
        <strong>会话流量分布</strong>
        <small>总量、客服和产品使用同一批会话数据，结果始终能够对账。</small>
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
          onApply={(from, to) => onRangeChange(customTrafficRange(from, to))}
        />
      </div>
    </header>
  );
}

export function AdminStatisticsTotalCard({
  stats,
  busy,
  total,
  accepted,
  pending,
}: {
  stats: TrafficOverviewStats | null;
  busy: boolean;
  total: number;
  accepted: number;
  pending: number;
}) {
  return (
    <article className="traffic-total-card">
      <div className="traffic-card-label">
        <span>TOTAL</span>
        <strong>会话总数</strong>
      </div>
      <div className="traffic-total-period" style={TOTAL_PERIOD_BADGE_STYLE}>
        <span style={TOTAL_PERIOD_LABEL_STYLE}>统计区间</span>
        <strong style={TOTAL_PERIOD_VALUE_STYLE}>
          {stats ? formatPeriod(stats.from, stats.to) : '正在读取…'}
        </strong>
      </div>
      <div className="traffic-total-value">
        <strong>{busy ? '—' : total.toLocaleString('zh-CN')}</strong>
        <span>个前端会话</span>
      </div>
      <div className="traffic-total-breakdown" style={TOTAL_BREAKDOWN_STYLE}>
        <div>
          <span>已接待</span>
          <strong>{busy ? '—' : accepted}</strong>
        </div>
        <div className={pending ? 'has-pending' : ''}>
          <span>待接待</span>
          <strong>{busy ? '—' : pending}</strong>
        </div>
      </div>
      <div className="traffic-total-visual" aria-hidden="true">
        {[42, 68, 52, 82, 63, 94, 72].map((height, index) => (
          <i key={index} style={{ height: `${height}%` }} />
        ))}
      </div>
    </article>
  );
}

export function AdminStatisticsDistributionCard({
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
  rows: AdminStatisticsDistributionRow[];
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

export function AdminStatisticsFooter({
  busy,
  agentTotal,
  productTotal,
  total,
}: {
  busy: boolean;
  agentTotal: number;
  productTotal: number;
  total: number;
}) {
  return (
    <footer className="traffic-overview-foot">
      <span>数据按 America/Los_Angeles 自然日统计，保留 90 天。</span>
      <strong>
        {busy
          ? '正在核对分布…'
          : `客服分布 ${agentTotal} / 产品分布 ${productTotal} / 总量 ${total}`}
      </strong>
    </footer>
  );
}

function formatShare(value: number, total: number): string {
  if (!total) return '0.0%';
  return `${((value / total) * 100).toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatPeriod(from: string, to: string): string {
  if (from === to) return from;
  return `${from} — ${to}`;
}
