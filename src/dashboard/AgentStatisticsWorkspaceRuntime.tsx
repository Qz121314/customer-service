import { useEffect, useMemo, useState } from 'react';
import {
  type AgentIdentity,
  type AgentSelfMonthlyStats,
  getAgentSelfMonthlyStats,
} from './api';
import { isAgentNotificationOpenMessage } from './agent-push';
import { calendarMonthPeriod } from '../shared/calendar-month';
import { MonthPicker } from './MonthPicker';
import { UiIcon } from './icons';

const CHAT_TIME_ZONE = 'America/Los_Angeles';

type AgentStatisticsCloseReason = 'dismiss' | 'notification';

export function AgentStatisticsModal({
  onClose,
}: {
  identity: AgentIdentity;
  onClose: (reason?: AgentStatisticsCloseReason) => void;
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
      if (event.key === 'Escape') onClose('dismiss');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const closeForNotification = (event: MessageEvent) => {
      if (isAgentNotificationOpenMessage(event.data)) onClose('notification');
    };
    navigator.serviceWorker.addEventListener('message', closeForNotification);
    return () =>
      navigator.serviceWorker.removeEventListener(
        'message',
        closeForNotification,
      );
  }, [onClose]);

  const countMap = useMemo(
    () => new Map((stats?.counts ?? []).map((item) => [item.day, item.count])),
    [stats],
  );
  const days =
    stats?.month === month ? stats.days : calendarMonthPeriod(month).days;

  return (
    <div
      className="agent-statistics-backdrop"
      onMouseDown={() => onClose('dismiss')}
    >
      <section
        className="agent-statistics-dialog agent-self-statistics-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="坐席接待数据"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-statistics-dialog-head">
          <div className="agent-statistics-head-actions">
            <button
              type="button"
              className="modal-close"
              aria-label="关闭接待流量"
              onClick={() => onClose('dismiss')}
            >
              <UiIcon name="close" />
            </button>
          </div>
        </header>

        <div className="agent-statistics-dialog-body">
          {error && <div className="notice error">{error}</div>}

          <div className="agent-statistics-overview">
            <section className="agent-statistics-card agent-statistics-calendar">
              <div className="agent-statistics-card-head">
                <div>
                  <strong>每日接待</strong>
                  <span>完整展示本月 {days.length} 天</span>
                </div>
                <MonthPicker value={month} onChange={setMonth} label="月份" />
              </div>
              <div className="agent-statistics-days">
                {days.map((day) => {
                  const value = countMap.get(day) ?? 0;
                  const dateLabel = `${month}-${String(day).padStart(2, '0')}`;
                  return (
                    <div
                      key={day}
                      className={value ? 'has-value' : ''}
                      aria-label={`${dateLabel} 接待 ${busy ? '加载中' : `${value} 次`}`}
                      title={dateLabel}
                    >
                      <span>{day}</span>
                      <strong>{busy ? '·' : value}</strong>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="agent-statistics-summary" aria-label="接待数据">
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
          </div>
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
