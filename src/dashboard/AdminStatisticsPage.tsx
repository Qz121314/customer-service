import { useEffect, useMemo, useState } from 'react';
import type { AgentAccount, AgentMonthlyStats } from './api';
import { initials, presenceClass, statusLabel } from './dashboard-runtime';
import { calendarMonthPeriod } from '../shared/calendar-month';

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function calendarStartOffset(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return 0;
  const weekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  return (weekday + 6) % 7;
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
  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.counts ?? []) {
      map.set(`${item.agentId}:${item.day}`, item.count);
    }
    return map;
  }, [stats]);
  const days = useMemo(
    () =>
      stats?.month === month ? stats.days : calendarMonthPeriod(month).days,
    [month, stats],
  );
  const calendarOffset = useMemo(() => calendarStartOffset(month), [month]);
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
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null;
  const selectedTotal = selectedAgent
    ? (agentTotals.get(selectedAgent.id) ?? 0)
    : 0;
  const selectedHandoffCount = selectedAgent
    ? ((stats?.handoffCounts ?? []).find(
        (item) => item.agentId === selectedAgent.id,
      )?.count ?? 0)
    : 0;
  const selectedCoverage = selectedTotal
    ? `${Math.min(100, (selectedHandoffCount / selectedTotal) * 100).toFixed(1)}%`
    : '0%';
  const monthlyTotal = [...agentTotals.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  const monthlyHandoffTotal = (stats?.handoffCounts ?? []).reduce(
    (sum, item) => sum + item.count,
    0,
  );
  const activeAgentCount = [...agentTotals.values()].filter(
    (count) => count > 0,
  ).length;
  const overallCoverage = monthlyTotal
    ? `${Math.min(100, (monthlyHandoffTotal / monthlyTotal) * 100).toFixed(1)}%`
    : '0%';
  const selectedDailyCounts = selectedAgent
    ? days.map((day) => ({
        day,
        count: countMap.get(`${selectedAgent.id}:${day}`) ?? 0,
      }))
    : [];
  const activeDayCount = selectedDailyCounts.filter(
    (item) => item.count > 0,
  ).length;
  const peakDay = selectedDailyCounts.reduce(
    (peak, item) => (item.count > peak.count ? item : peak),
    { day: 0, count: 0 },
  );
  const maxDailyCount = selectedDailyCounts.reduce(
    (max, item) => Math.max(max, item.count),
    0,
  );

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId) setSelectedAgentId('');
      return;
    }
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  return (
    <section className="statistics-panel admin-statistics-workspace">
      <div className="statistics-toolbar">
        <div className="statistics-toolbar-copy">
          <span>月度对账</span>
          <strong>流量总览</strong>
          <small>按客服首次有效接待统计</small>
        </div>
        <label className="statistics-month-control">
          <span>统计月份</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>

      <section className="statistics-global-summary" aria-label="月度流量概览">
        <div>
          <span>本月总接待</span>
          <strong>{busy ? '—' : monthlyTotal}</strong>
        </div>
        <div>
          <span>有流量坐席</span>
          <strong>{busy ? '—' : activeAgentCount}</strong>
        </div>
        <div>
          <span>可逐笔对账</span>
          <strong>{busy ? '—' : monthlyHandoffTotal}</strong>
        </div>
        <div>
          <span>总体覆盖率</span>
          <strong>{busy ? '—' : overallCoverage}</strong>
        </div>
      </section>

      {selectedAgent ? (
        <div className="statistics-seat-layout">
          <aside className="statistics-seat-sidebar">
            <header>
              <div>
                <span>坐席列表</span>
                <strong>客服账号</strong>
              </div>
              <small>{agents.length}</small>
            </header>
            <nav aria-label="选择客服坐席">
              {agents.map((agent) => {
                const isSelected = agent.id === selectedAgent.id;
                return (
                  <button
                    type="button"
                    key={agent.id}
                    className={isSelected ? 'active' : ''}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedAgentId(agent.id)}
                  >
                    <span className="avatar tiny">{initials(agent.name)}</span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>@{agent.username || '未设置账号'}</small>
                    </span>
                    <b>{busy ? '—' : (agentTotals.get(agent.id) ?? 0)}</b>
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
              <div>
                <span>本月接待</span>
                <strong>{busy ? '—' : selectedTotal}</strong>
              </div>
              <div>
                <span>可逐笔对账</span>
                <strong>{busy ? '—' : selectedHandoffCount}</strong>
              </div>
              <div>
                <span>对账覆盖率</span>
                <strong>{busy ? '—' : selectedCoverage}</strong>
              </div>
              <div>
                <span>活跃天数</span>
                <strong>{busy ? '—' : activeDayCount}</strong>
              </div>
            </div>

            <div className="statistics-day-section">
              <header>
                <div>
                  <span>日历视图</span>
                  <strong>每日接待流量</strong>
                </div>
                <small className="statistics-peak-chip">
                  {busy
                    ? '峰值 —'
                    : peakDay.count
                      ? `峰值 ${peakDay.count} · ${peakDay.day} 日`
                      : '本月暂无流量'}
                </small>
              </header>

              <div className="statistics-calendar">
                <div className="statistics-calendar-weekdays" aria-hidden="true">
                  {WEEKDAY_LABELS.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
                <div className="statistics-calendar-grid">
                  {Array.from({ length: calendarOffset }, (_, index) => (
                    <span
                      key={`offset-${index}`}
                      className="statistics-day-spacer"
                      aria-hidden="true"
                    />
                  ))}
                  {selectedDailyCounts.map(({ day, count }) => {
                    const ratio = maxDailyCount ? count / maxDailyCount : 0;
                    const level =
                      count === 0
                        ? 0
                        : ratio >= 0.75
                          ? 3
                          : ratio >= 0.4
                            ? 2
                            : 1;
                    return (
                      <div
                        key={day}
                        className={`statistics-day-cell level-${level}`}
                        aria-label={`${day} 日，${count} 次接待`}
                      >
                        <span>{day}</span>
                        <strong>{busy ? '·' : count || ''}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
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
