import { useEffect, useMemo, useState } from 'react';
import type { AgentAccount, AgentMonthlyStats } from './api';
import { initials, presenceClass, statusLabel } from './dashboard-runtime';
import { calendarMonthPeriod } from '../shared/calendar-month';

export function AdminStatisticsModal({
  agents,
  month,
  stats,
  busy,
  error,
  onClearError,
  onMonthChange,
  onClose,
}: {
  agents: AgentAccount[];
  month: string;
  stats: AgentMonthlyStats | null;
  busy: boolean;
  error: string;
  onClearError: () => void;
  onMonthChange: (month: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop admin-statistics-backdrop"
      onMouseDown={onClose}
    >
      <section
        className="admin-statistics-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-statistics-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="admin-statistics-modal-head">
          <div>
            <span className="eyebrow">流量账本</span>
            <h2 id="admin-statistics-title">坐席接待流量</h2>
            <p>按客服查看首次实际接收的访客流量，转接和重新排队不重复计数。</p>
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭坐席流量"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="admin-statistics-modal-body">
          {error && (
            <button
              type="button"
              className="notice error"
              onClick={onClearError}
            >
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
        </div>
      </section>
    </div>
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
  const days =
    stats?.month === month ? stats.days : calendarMonthPeriod(month).days;
  const agentTotals = new Map(
    agents.map((agent) => [
      agent.id,
      days.reduce(
        (sum, day) => sum + (countMap.get(`${agent.id}:${day}`) ?? 0),
        0,
      ),
    ]),
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

  useEffect(() => {
    if (agents.length === 0) {
      if (selectedAgentId) setSelectedAgentId('');
      return;
    }
    if (agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  return (
    <section className="statistics-panel">
      <div className="statistics-toolbar">
        <div>
          <strong>按坐席核对流量</strong>
          <span>选择客服坐席，查看每天首次实际接收的访客流量</span>
        </div>
        <label>
          <span>月份</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>
      {selectedAgent ? (
        <div className="statistics-seat-layout">
          <aside className="statistics-seat-sidebar">
            <header>
              <div>
                <strong>客服坐席</strong>
                <span>{agents.length} 个账号</span>
              </div>
              <small>本月接待</small>
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

            <div className="statistics-summary">
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
            </div>

            <div className="statistics-day-section">
              <header>
                <div>
                  <strong>每日接待流量</strong>
                  <span>每个访客会话只在首次进入坐席时计 1 次</span>
                </div>
                <small>完整月份 · {days.length} 天</small>
              </header>
              <div className="statistics-day-grid">
                {days.map((day) => {
                  const value = countMap.get(`${selectedAgent.id}:${day}`) ?? 0;
                  return (
                    <div key={day} className={value ? 'has-value' : ''}>
                      <span>{day} 日</span>
                      <strong>{busy ? '·' : value || '—'}</strong>
                    </div>
                  );
                })}
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
      <p className="statistics-note">
        每日上限按 America/Los_Angeles 自然日计算；流量账本独立于 24
        小时聊天记录保存并保留 400 天。每个统计周期对应一个完整自然月，自动展示
        28、29、30 或 31 天。“可逐笔对账”表示同时带有 Site
        分发编号的流量；旧数据和直接调用客服 API
        的会话仍计入接待总数，但不计入对账覆盖率。
      </p>
    </section>
  );
}
