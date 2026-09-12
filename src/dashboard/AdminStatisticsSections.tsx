import type { CSSProperties } from 'react';
import type { AgentAccount, TrafficOverviewStats } from './api';
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
  { value: '3d', label: '近 3 天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

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
      <span className="traffic-range-label">统计范围</span>
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
  const metrics = [
    ['会话总数', busy ? '—' : total.toLocaleString('zh-CN'), ''],
    ['已接待', busy ? '—' : accepted.toLocaleString('zh-CN'), ''],
    [
      '待接待',
      busy ? '—' : pending.toLocaleString('zh-CN'),
      pending ? 'is-warning' : '',
    ],
    [
      '统计区间',
      stats ? formatPeriod(stats.from, stats.to) : '正在读取…',
      'is-period',
    ],
  ] as const;

  return (
    <section className="traffic-summary-card" aria-label="会话情况">
      <div className="traffic-summary-strip">
        {metrics.map(([label, value, tone]) => (
          <div className={`traffic-summary-metric ${tone}`} key={label}>
            <span>{label}</span>
            <strong title={value}>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminStatisticsOperationsCard({
  agents,
  stats,
  range,
  busy,
}: {
  agents: AgentAccount[];
  stats: TrafficOverviewStats | null;
  range: TrafficRange;
  busy: boolean;
}) {
  const enabledAgents = agents.filter((agent) => agent.isEnabled);
  const onlineAgents = enabledAgents.filter(
    (agent) => agent.status === 'online',
  );
  const busyAgents = enabledAgents.filter((agent) => agent.status === 'busy');
  const offlineAgents =
    enabledAgents.length - onlineAgents.length - busyAgents.length;
  const todayReceptionCount =
    range === 'today' && stats
      ? stats.agents.reduce(
          (total, agent) => total + (agent.agentId ? agent.count : 0),
          0,
        )
      : enabledAgents.reduce(
          (total, agent) => total + agent.todayConversationCount,
          0,
        );

  const metrics = [
    ['在线', onlineAgents.length, 'is-online'],
    ['忙碌', busyAgents.length, 'is-busy'],
    ['离线', offlineAgents, ''],
    ['今日接待', todayReceptionCount, ''],
  ] as const;

  return (
    <section className="traffic-operations-card" aria-label="坐席运营状态">
      <div
        className={
          busy
            ? 'traffic-operations-metrics is-loading'
            : 'traffic-operations-metrics'
        }
      >
        {metrics.map(([label, value, tone]) => (
          <div className={tone} key={label}>
            <span>{label}</span>
            <strong>{busy ? '—' : value.toLocaleString('zh-CN')}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AdminStatisticsDistributionCard({
  title,
  emptyLabel,
  total,
  busy,
  rows,
}: {
  title: string;
  emptyLabel: string;
  total: number;
  busy: boolean;
  rows: AdminStatisticsDistributionRow[];
}) {
  return (
    <article className="traffic-distribution-card">
      <header>
        <strong>{title}</strong>
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
                  <div className="traffic-row-meter" aria-hidden="true">
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
            <strong>{busy ? '正在读取' : emptyLabel}</strong>
            <small>产生新会话后会自动形成分布</small>
          </div>
        )}
      </div>
    </article>
  );
}

export function AdminStatisticsFooter() {
  return (
    <footer className="traffic-overview-foot">
      数据按 America/Los_Angeles 自然日统计，保留 90 天。
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
