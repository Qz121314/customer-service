import { useEffect, useMemo, useState } from 'react';
import {
  type AdminAgentMonthlyStats,
  type AgentAccount,
  getAdminAgentMonthlyStats,
} from './api';
import { calendarMonthPeriod } from '../shared/calendar-month';
import { CHAT_TIME_ZONE, message } from './dashboard-runtime';

export function AdminAgentStatisticsModal({
  agent,
  onClose,
}: {
  agent: AgentAccount;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => currentBusinessMonth());
  const [stats, setStats] = useState<AdminAgentMonthlyStats | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    getAdminAgentMonthlyStats(month, agent.id)
      .then((value) => {
        if (active) setStats(value);
      })
      .catch((reason) => {
        if (active) setError(message(reason, '无法加载客服接待统计'));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [agent.id, month]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const countMap = useMemo(
    () => new Map((stats?.counts ?? []).map((item) => [item.day, item.count])),
    [stats],
  );
  const days =
    stats?.month === month ? stats.days : calendarMonthPeriod(month).days;
  const total = days.reduce((sum, day) => sum + (countMap.get(day) ?? 0), 0);
  const activeDays = days.filter((day) => (countMap.get(day) ?? 0) > 0).length;
  const peak = days.reduce(
    (current, day) => {
      const count = countMap.get(day) ?? 0;
      return count > current.count ? { day, count } : current;
    },
    { day: 0, count: 0 },
  );

  return (
    <div className="agent-statistics-backdrop" onMouseDown={onClose}>
      <section
        className="agent-statistics-dialog admin-agent-statistics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-agent-statistics-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-statistics-dialog-head">
          <div>
            <span className="eyebrow">客服统计</span>
            <h2 id="admin-agent-statistics-title">{agent.name} · 接待统计</h2>
            <p>只统计每天首次有效接待的会话，不展示产品归因。</p>
          </div>
          <div className="agent-statistics-head-actions">
            <label>
              <span>月份</span>
              <input
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="modal-close"
              aria-label="关闭客服统计"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <div className="agent-statistics-dialog-body">
          {error && <div className="notice error">{error}</div>}
          <section className="agent-statistics-summary admin-agent-statistics-summary">
            <div>
              <span>本月接待</span>
              <strong>{busy ? '—' : total}</strong>
              <small>首次有效接待累计</small>
            </div>
            <div>
              <span>活跃天数</span>
              <strong>{busy ? '—' : activeDays}</strong>
              <small>有接待记录的日期</small>
            </div>
            <div>
              <span>单日最高</span>
              <strong>{busy ? '—' : peak.count}</strong>
              <small>{peak.count ? `${peak.day} 日` : '暂无接待'}</small>
            </div>
          </section>
          <section className="agent-statistics-card">
            <div className="agent-statistics-card-head">
              <div>
                <strong>每日接待</strong>
                <span>
                  {month} · 共 {days.length} 天
                </span>
              </div>
              <small>可查询范围从 {stats?.retainedFrom ?? '—'} 起</small>
            </div>
            <div className="agent-statistics-days">
              {days.map((day) => {
                const value = countMap.get(day) ?? 0;
                const date = `${month}-${String(day).padStart(2, '0')}`;
                return (
                  <div
                    key={day}
                    className={value ? 'has-value' : ''}
                    aria-label={`${date} 接待 ${busy ? '加载中' : `${value} 次`}`}
                    title={date}
                  >
                    <span>{day}</span>
                    <strong>{busy ? '·' : value}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function currentBusinessMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}`;
}
