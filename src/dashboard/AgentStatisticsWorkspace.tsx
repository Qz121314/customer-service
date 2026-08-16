import { useEffect, useMemo, useState } from 'react';
import {
  type AgentIdentity,
  type AgentSelfMonthlyStats,
  getAgentSelfMonthlyStats,
} from './api';
import { calendarMonthPeriod } from '../shared/calendar-month';

const CHAT_TIME_ZONE = 'America/Los_Angeles';

export function AgentStatisticsModal({
  identity,
  onClose,
}: {
  identity: AgentIdentity;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(() => currentBusinessMonth());
  const [stats, setStats] = useState<AgentSelfMonthlyStats | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    getAgentSelfMonthlyStats(month)
      .then((value) => {
        if (active) setStats(value);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法加载接待流量',
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [month]);

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

  return (
    <div className="agent-statistics-backdrop" onMouseDown={onClose}>
      <section
        className="agent-statistics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-statistics-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-statistics-dialog-head">
          <div>
            <span className="eyebrow">接待数据</span>
            <h2 id="agent-statistics-title">{identity.name} 的接待流量</h2>
            <p>访客首次进入坐席时计 1 次，转接和重新排队不重复计数。</p>
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
              aria-label="关闭接待流量"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        <div className="agent-statistics-dialog-body">
          {error && <div className="notice error">{error}</div>}

          <section className="agent-statistics-summary">
            <div>
              <span>本月接待</span>
              <strong>{busy ? '—' : (stats?.total ?? 0)}</strong>
              <small>完整自然月累计</small>
            </div>
            <div>
              <span>今日接待</span>
              <strong>{busy ? '—' : (stats?.todayCount ?? 0)}</strong>
              <small>西海岸自然日</small>
            </div>
            <div>
              <span>每日上限</span>
              <strong>
                {busy ? '—' : stats?.dailyLimit ? stats.dailyLimit : '不限'}
              </strong>
              <small>达到后停止新分流</small>
            </div>
            <div>
              <span>剩余额度</span>
              <strong>
                {busy
                  ? '—'
                  : stats?.trafficQuotaEnabled
                    ? (stats?.trafficQuotaRemaining ?? 0)
                    : '不限'}
              </strong>
              <small>
                {stats?.trafficQuotaEnabled
                  ? `总 ${stats.trafficQuotaTotal} · 已用 ${stats.trafficQuotaUsed}`
                  : '未启用总额度限制'}
              </small>
            </div>
          </section>

          <section className="agent-statistics-card">
            <div className="agent-statistics-card-head">
              <div>
                <strong>{month} 每日接待</strong>
                <span>
                  完整展示本月 {days.length} 天，颜色越深代表接待量越高
                </span>
              </div>
              <small>可查询范围从 {stats?.retainedFrom ?? '—'} 起</small>
            </div>
            <div className="agent-statistics-days">
              {days.map((day) => {
                const value = countMap.get(day) ?? 0;
                return (
                  <div key={day} className={value ? 'has-value' : ''}>
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
