import { useEffect, useMemo, useState } from 'react';
import {
  type AdminAgentDateRangeStats,
  type AgentAccount,
  getAdminAgentDateRangeStats,
} from './api';
import { message } from './dashboard-runtime';
import {
  currentReportingDate,
  reportingRetentionStart,
  shiftReportingDate,
} from './traffic-statistics-range';
import { UiIcon } from './icons';

export function AdminAgentStatisticsModal({
  agent,
  onClose,
}: {
  agent: AgentAccount;
  onClose: () => void;
}) {
  const today = currentReportingDate();
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [stats, setStats] = useState<AdminAgentDateRangeStats | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setStats(null);
    if (!from || !to || from > to) {
      setBusy(false);
      setError('请选择有效的开始和结束日期');
      return () => {
        active = false;
      };
    }
    getAdminAgentDateRangeStats(from, to, agent.id)
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
  }, [agent.id, from, to]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  const countMap = useMemo(
    () => new Map((stats?.counts ?? []).map((item) => [item.date, item.count])),
    [stats],
  );
  const days = useMemo(() => {
    if (!from || !to || from > to) return [];
    const rangeFrom = stats?.from ?? from;
    const rangeTo = stats?.to ?? to;
    const dates: string[] = [];
    for (
      let date = rangeFrom;
      date <= rangeTo;
      date = shiftReportingDate(date, 1)
    ) {
      dates.push(date);
    }
    return dates;
  }, [from, stats, to]);
  const calendarCells = useMemo(() => {
    if (!days.length) return [];
    const [year, month, day] = days[0].split('-').map(Number);
    const mondayOffset = (new Date(year, month - 1, day).getDay() + 6) % 7;
    return [...Array<string | null>(mondayOffset).fill(null), ...days];
  }, [days]);
  const total = days.reduce((sum, date) => sum + (countMap.get(date) ?? 0), 0);
  const activeDays = days.filter(
    (date) => (countMap.get(date) ?? 0) > 0,
  ).length;
  const peak = days.reduce(
    (current, day) => {
      const count = countMap.get(day) ?? 0;
      return count > current.count ? { date: day, count } : current;
    },
    { date: '', count: 0 },
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
            <p>统计所选日期内每天首次有效接待的会话。</p>
          </div>
          <div className="admin-agent-statistics-range">
            <label>
              开始日期
              <input
                type="date"
                value={from}
                min={reportingRetentionStart(today)}
                max={to || today}
                onChange={(event) => {
                  setStats(null);
                  setBusy(true);
                  setFrom(event.target.value);
                }}
              />
            </label>
            <span aria-hidden="true">至</span>
            <label>
              结束日期
              <input
                type="date"
                value={to}
                min={from || reportingRetentionStart(today)}
                max={today}
                onChange={(event) => {
                  setStats(null);
                  setBusy(true);
                  setTo(event.target.value);
                }}
              />
            </label>
          </div>
          <div className="agent-statistics-head-actions">
            <button
              type="button"
              className="modal-close"
              aria-label="关闭客服统计"
              onClick={onClose}
            >
              <UiIcon name="close" />
            </button>
          </div>
        </header>
        <div className="agent-statistics-dialog-body">
          {error && <div className="notice error">{error}</div>}
          <section className="agent-statistics-summary admin-agent-statistics-summary">
            <div>
              <span>区间接待</span>
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
              <small>{peak.date || '暂无接待'}</small>
            </div>
          </section>
          <section className="agent-statistics-card admin-agent-statistics-card">
            <div className="agent-statistics-card-head">
              <div>
                <strong>每日接待</strong>
                <span>
                  {stats?.from ?? from} 至 {stats?.to ?? to} · 共 {days.length}{' '}
                  天
                </span>
              </div>
              <small>可查询范围从 {stats?.retainedFrom ?? '—'} 起</small>
            </div>
            <div
              className="admin-agent-statistics-calendar"
              role="group"
              aria-label="每日接待统计"
            >
              {['一', '二', '三', '四', '五', '六', '日'].map((weekday) => (
                <span key={weekday} className="admin-agent-statistics-weekday">
                  {weekday}
                </span>
              ))}
              {calendarCells.map((date, index) => {
                if (!date) {
                  return (
                    <span
                      key={`blank-${index}`}
                      className="admin-agent-statistics-day-blank"
                      aria-hidden="true"
                    />
                  );
                }
                const value = countMap.get(date) ?? 0;
                return (
                  <div
                    key={date}
                    className={`admin-agent-statistics-day${value ? ' has-value' : ''}`}
                    role="group"
                    aria-label={`${date} 接待 ${busy ? '加载中' : `${value} 次`}`}
                    title={date}
                  >
                    <span>{date.slice(5)}</span>
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
