import { useEffect, useMemo, useState } from 'react';
import type { AgentAccount, AgentMonthlyStats } from './api';
import { initials, presenceClass, statusLabel } from './dashboard-runtime';
import { calendarMonthPeriod } from '../shared/calendar-month';

const CHART_WIDTH = 760;
const CHART_HEIGHT = 220;
const CHART_LEFT = 42;
const CHART_RIGHT = 18;
const CHART_TOP = 18;
const CHART_BOTTOM = 34;
const SEATS_PER_PAGE = 5;

type TrendPoint = {
  x: number;
  y: number;
  value: number;
  day: string;
};

function formatDecimal(value: number) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function buildTrendPoints(dailyValues: Array<{ day: string; value: number }>): {
  points: TrendPoint[];
  line: string;
  area: string;
  maxValue: number;
} {
  const maxValue = Math.max(1, ...dailyValues.map((item) => item.value));
  const plotWidth = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
  const denominator = Math.max(1, dailyValues.length - 1);

  const points = dailyValues.map((item, index) => ({
    x: CHART_LEFT + (index / denominator) * plotWidth,
    y: CHART_TOP + (1 - item.value / maxValue) * plotHeight,
    value: item.value,
    day: item.day,
  }));
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const baseline = CHART_HEIGHT - CHART_BOTTOM;
  const area =
    points.length > 0
      ? `${CHART_LEFT},${baseline} ${line} ${points[points.length - 1]?.x ?? CHART_LEFT},${baseline}`
      : '';

  return { points, line, area, maxValue };
}

export function AdminStatisticsPage({
  agents,
  month,
  stats,
  busy,
  error,
  onClearError,
  onMonthChange,
}: {
  agents: AgentAccount[];
  month: string;
  stats: AgentMonthlyStats | null;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onMonthChange: (month: string) => void;
}) {
  return (
    <section className="admin-statistics-page">
      {error && (
        <button type="button" className="notice error" onClick={onClearError}>
          {error}
        </button>
      )}
      <MonthlyAgentStatistics
        agents={agents}
        month={month}
        stats={stats}
        busy={busy}
        onMonthChange={onMonthChange}
      />
    </section>
  );
}

function MonthlyAgentStatistics({
  agents,
  month,
  stats,
  busy,
  onMonthChange,
}: {
  agents: AgentAccount[];
  month: string;
  stats: AgentMonthlyStats | null;
  busy: boolean;
  onMonthChange: (month: string) => void;
}) {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [seatPage, setSeatPage] = useState(0);
  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.counts ?? []) {
      map.set(`${item.agentId}:${item.day}`, item.count);
    }
    return map;
  }, [stats]);
  const handoffMap = useMemo(
    () =>
      new Map(
        (stats?.handoffCounts ?? []).map((item) => [item.agentId, item.count]),
      ),
    [stats],
  );
  const days = useMemo(
    () =>
      stats?.month === month ? stats.days : calendarMonthPeriod(month).days,
    [month, stats],
  );
  const agentTotals = useMemo(
    () =>
      new Map(
        agents.map((agent) => [
          agent.id,
          days.reduce(
            (sum, day) => sum + (countMap.get(`${agent.id}:${day}`) ?? 0),
            0,
          ),
        ]),
      ),
    [agents, countMap, days],
  );
  const orderedAgents = useMemo(
    () =>
      [...agents].sort((left, right) => {
        const difference =
          (agentTotals.get(right.id) ?? 0) - (agentTotals.get(left.id) ?? 0);
        return difference || left.name.localeCompare(right.name, 'zh-CN');
      }),
    [agentTotals, agents],
  );
  const selectedAgent =
    orderedAgents.find((agent) => agent.id === selectedAgentId) ??
    orderedAgents[0] ??
    null;
  const selectedTotal = selectedAgent
    ? (agentTotals.get(selectedAgent.id) ?? 0)
    : 0;
  const selectedHandoffCount = selectedAgent
    ? (handoffMap.get(selectedAgent.id) ?? 0)
    : 0;
  const selectedCoverageValue = selectedTotal
    ? Math.min(100, (selectedHandoffCount / selectedTotal) * 100)
    : 0;
  const selectedCoverage = `${selectedCoverageValue.toFixed(1)}%`;
  const monthlyTotal = [...agentTotals.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const monthlyHandoffTotal = [...handoffMap.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const activeAgentCount = [...agentTotals.values()].filter(
    (count) => count > 0,
  ).length;
  const overallCoverageValue = monthlyTotal
    ? Math.min(100, (monthlyHandoffTotal / monthlyTotal) * 100)
    : 0;
  const overallCoverage = `${overallCoverageValue.toFixed(1)}%`;
  const monthlyAverage = days.length ? monthlyTotal / days.length : 0;
  const unreconciledTotal = Math.max(0, monthlyTotal - monthlyHandoffTotal);
  const maxAgentTotal = Math.max(1, ...agentTotals.values());
  const selectedDaily = useMemo(
    () =>
      selectedAgent
        ? days.map((day) => ({
            day: String(day),
            value: countMap.get(`${selectedAgent.id}:${day}`) ?? 0,
          }))
        : [],
    [countMap, days, selectedAgent],
  );
  const selectedActiveDays = selectedDaily.filter(
    (item) => item.value > 0,
  ).length;
  const selectedAverage = selectedActiveDays
    ? selectedTotal / selectedActiveDays
    : 0;
  const selectedPeak = selectedDaily.reduce(
    (peak, item) => (item.value > peak.value ? item : peak),
    { day: '—', value: 0 },
  );
  const chart = useMemo(() => buildTrendPoints(selectedDaily), [selectedDaily]);
  const monthLabel = month
    ? `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`
    : '当前月份';
  const seatPageCount = Math.max(
    1,
    Math.ceil(orderedAgents.length / SEATS_PER_PAGE),
  );
  const seatPageStart = seatPage * SEATS_PER_PAGE;
  const visibleSeatAgents = orderedAgents.slice(
    seatPageStart,
    seatPageStart + SEATS_PER_PAGE,
  );

  useEffect(() => {
    if (orderedAgents.length === 0) {
      if (selectedAgentId) setSelectedAgentId('');
      setSeatPage(0);
      return;
    }
    const selectedIndex = orderedAgents.findIndex(
      (agent) => agent.id === selectedAgentId,
    );
    if (selectedIndex >= 0) {
      setSeatPage(Math.floor(selectedIndex / SEATS_PER_PAGE));
      return;
    }
    setSelectedAgentId(orderedAgents[0].id);
    setSeatPage(0);
  }, [orderedAgents, selectedAgentId]);

  function changeSeatPage(nextPage: number) {
    const page = Math.min(Math.max(nextPage, 0), seatPageCount - 1);
    const firstAgent = orderedAgents[page * SEATS_PER_PAGE];
    setSeatPage(page);
    if (firstAgent) setSelectedAgentId(firstAgent.id);
  }

  return (
    <section className="statistics-panel admin-statistics-workspace">
      <div className="statistics-toolbar statistics-hero">
        <div className="statistics-hero-copy">
          <span className="statistics-kicker">TRAFFIC RECONCILIATION</span>
          <strong>月度流量对账</strong>
          <span>首次有效接待计数，集中查看总量、坐席贡献和每日趋势。</span>
        </div>
        <label className="statistics-period-control">
          <span>统计月份</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>

      <section className="statistics-global-summary" aria-label="月度流量概览">
        <article className="statistics-kpi-card is-primary">
          <span className="statistics-kpi-label">本月总接待</span>
          <strong>{busy ? '—' : monthlyTotal}</strong>
          <small>
            {busy ? '数据加载中' : `日均 ${formatDecimal(monthlyAverage)} 次`}
          </small>
        </article>
        <article className="statistics-kpi-card">
          <span className="statistics-kpi-label">有流量坐席</span>
          <strong>{busy ? '—' : activeAgentCount}</strong>
          <small>{busy ? '数据加载中' : `${agents.length} 个客服账号`}</small>
        </article>
        <article className="statistics-kpi-card">
          <span className="statistics-kpi-label">可逐笔对账</span>
          <strong>{busy ? '—' : monthlyHandoffTotal}</strong>
          <small>
            {busy ? '数据加载中' : `${unreconciledTotal} 笔无 Site 分发号`}
          </small>
        </article>
        <article className="statistics-kpi-card is-coverage">
          <span className="statistics-kpi-label">总体覆盖率</span>
          <strong>{busy ? '—' : overallCoverage}</strong>
          <small>Site 分发编号覆盖</small>
          <span className="statistics-kpi-progress" aria-hidden="true">
            <i style={{ width: `${overallCoverageValue}%` }} />
          </span>
        </article>
      </section>

      {selectedAgent ? (
        <div className="statistics-seat-layout">
          <aside className="statistics-seat-sidebar">
            <header>
              <div>
                <span className="statistics-panel-kicker">坐席贡献</span>
                <strong>客服排名</strong>
                <span>{monthLabel}</span>
              </div>
              <div className="statistics-seat-tools">
                <small>{agents.length} 人</small>
                {seatPageCount > 1 && (
                  <div
                    className="statistics-seat-pagination"
                    aria-label="客服排行分页"
                  >
                    <button
                      type="button"
                      aria-label="上一组客服"
                      disabled={seatPage === 0}
                      onClick={() => changeSeatPage(seatPage - 1)}
                    >
                      ‹
                    </button>
                    <span>
                      {seatPage + 1}/{seatPageCount}
                    </span>
                    <button
                      type="button"
                      aria-label="下一组客服"
                      disabled={seatPage >= seatPageCount - 1}
                      onClick={() => changeSeatPage(seatPage + 1)}
                    >
                      ›
                    </button>
                  </div>
                )}
              </div>
            </header>
            <nav aria-label="选择客服坐席">
              {visibleSeatAgents.map((agent, index) => {
                const total = agentTotals.get(agent.id) ?? 0;
                const progress = Math.min(100, (total / maxAgentTotal) * 100);
                const isSelected = agent.id === selectedAgent.id;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={isSelected ? 'active' : ''}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span className="statistics-seat-rank">
                      {String(seatPageStart + index + 1).padStart(2, '0')}
                    </span>
                    <span className="avatar tiny">{initials(agent.name)}</span>
                    <span className="statistics-seat-copy">
                      <strong>{agent.name}</strong>
                      <small>@{agent.username || '未设置账号'}</small>
                      <span
                        className="statistics-seat-progress"
                        aria-hidden="true"
                      >
                        <i style={{ width: `${progress}%` }} />
                      </span>
                    </span>
                    <b>{busy ? '—' : total}</b>
                  </button>
                );
              })}
            </nav>
          </aside>

          <section className="statistics-seat-detail" aria-live="polite">
            <header className="statistics-seat-head">
              <div className="statistics-agent-identity">
                <span className="avatar small">
                  {initials(selectedAgent.name)}
                </span>
                <div>
                  <span>当前坐席</span>
                  <strong>{selectedAgent.name}</strong>
                  <small>@{selectedAgent.username || '未设置账号'}</small>
                </div>
              </div>
              <span
                className={`account-status ${presenceClass(selectedAgent)}`}
              >
                {selectedAgent.isEnabled
                  ? statusLabel(selectedAgent.status)
                  : '已停用'}
              </span>
            </header>

            <div className="statistics-seat-metrics">
              <article>
                <span>本月接待</span>
                <strong>{busy ? '—' : selectedTotal}</strong>
                <small>
                  {busy
                    ? '—'
                    : `${selectedActiveDays} 个活跃日 · 活跃日均 ${formatDecimal(selectedAverage)}`}
                </small>
              </article>
              <article>
                <span>峰值日</span>
                <strong>{busy ? '—' : selectedPeak.value}</strong>
                <small>
                  {busy || selectedPeak.value === 0
                    ? '暂无峰值'
                    : `${selectedPeak.day} 日最高`}
                </small>
              </article>
              <article>
                <span>可逐笔对账</span>
                <strong>{busy ? '—' : selectedHandoffCount}</strong>
                <small>带 Site 分发编号</small>
              </article>
              <article>
                <span>对账覆盖率</span>
                <strong>{busy ? '—' : selectedCoverage}</strong>
                <small>当前坐席覆盖情况</small>
              </article>
            </div>

            <section className="statistics-trend-card">
              <header>
                <div>
                  <span className="statistics-panel-kicker">DAILY TREND</span>
                  <strong>每日接待趋势</strong>
                  <span>自然日维度 · 首次有效接待</span>
                </div>
                <div className="statistics-trend-legend">
                  <span>
                    <i />
                    接待量
                  </span>
                  <strong>{days.length} 天</strong>
                </div>
              </header>

              <div className="statistics-chart-wrap">
                <svg
                  className="statistics-chart"
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  role="img"
                  aria-label={`${selectedAgent.name} ${monthLabel}每日接待趋势`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient
                      id="adminTrafficTrendFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#5b5bd6" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#5b5bd6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[1, 0.5, 0].map((ratio) => {
                    const y =
                      CHART_TOP +
                      (1 - ratio) * (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM);
                    return (
                      <g key={ratio}>
                        <line
                          className="statistics-chart-grid"
                          x1={CHART_LEFT}
                          x2={CHART_WIDTH - CHART_RIGHT}
                          y1={y}
                          y2={y}
                        />
                        <text
                          className="statistics-chart-y-label"
                          x={CHART_LEFT - 10}
                          y={y + 3}
                          textAnchor="end"
                        >
                          {Math.round(chart.maxValue * ratio)}
                        </text>
                      </g>
                    );
                  })}
                  {chart.area && (
                    <polygon
                      className="statistics-chart-area"
                      points={chart.area}
                    />
                  )}
                  {chart.line && (
                    <polyline
                      className="statistics-chart-line"
                      points={chart.line}
                    />
                  )}
                  {chart.points.map((point, index) => (
                    <g key={point.day}>
                      {(index % 5 === 0 ||
                        index === chart.points.length - 1) && (
                        <text
                          className="statistics-chart-x-label"
                          x={point.x}
                          y={CHART_HEIGHT - 9}
                          textAnchor={
                            index === 0
                              ? 'start'
                              : index === chart.points.length - 1
                                ? 'end'
                                : 'middle'
                          }
                        >
                          {point.day}日
                        </text>
                      )}
                      {point.value > 0 && (
                        <circle
                          className="statistics-chart-point"
                          cx={point.x}
                          cy={point.y}
                          r="3.5"
                        >
                          <title>
                            {point.day} 日 · {point.value} 次接待
                          </title>
                        </circle>
                      )}
                    </g>
                  ))}
                </svg>
              </div>
            </section>

            <section className="statistics-day-section">
              <header>
                <div>
                  <span className="statistics-panel-kicker">DAILY LEDGER</span>
                  <strong>每日明细</strong>
                  <span>保留精确日数据，便于快速核对异常日期。</span>
                </div>
                <small>完整月份 · {days.length} 天</small>
              </header>
              <div className="statistics-day-grid">
                {selectedDaily.map(({ day, value }) => (
                  <div key={day} className={value ? 'has-value' : ''}>
                    <span>{day} 日</span>
                    <strong>{busy ? '·' : value || '—'}</strong>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </div>
      ) : (
        <div className="statistics-empty">
          <strong>暂无客服坐席</strong>
          <span>创建客服账号后，这里会按坐席显示每日接待数量。</span>
        </div>
      )}

      <details className="statistics-footnote">
        <summary>统计口径说明</summary>
        <p>
          每日上限按 America/Los_Angeles 自然日计算；流量账本独立于 24
          小时聊天记录保存并保留 400 天。可逐笔对账表示该流量带有 Site
          分发编号；旧数据和直接调用客服 API 的会话仍计入接待总数。
        </p>
      </details>
    </section>
  );
}
