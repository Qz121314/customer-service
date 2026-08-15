import { useEffect, useMemo, useState } from 'react';
import {
  type AgentIdentity,
  type AgentSelfMonthlyStats,
  getAgentSelfMonthlyStats,
} from './api';

const CHAT_TIME_ZONE = 'America/Los_Angeles';

export function AgentStatisticsWorkspace({
  identity,
  onLogout,
}: {
  identity: AgentIdentity;
  onLogout: () => Promise<void>;
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
          setError(reason instanceof Error ? reason.message : '无法加载会话统计');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [month]);

  const countMap = useMemo(
    () => new Map((stats?.counts ?? []).map((item) => [item.day, item.count])),
    [stats],
  );
  const days =
    stats?.days ?? Array.from({ length: 30 }, (_, index) => index + 1);

  return (
    <div className="workspace-shell agent-statistics-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-brand">CS</div>
        <div className="agent-profile">
          <span className="avatar">{initials(identity.name)}</span>
          <div>
            <strong>{identity.name}</strong>
            <small>@{identity.username}</small>
          </div>
          <i className="presence online" />
        </div>
        <nav className="agent-statistics-nav" aria-label="客服工作台导航">
          <a className="ghost-button full" href="/agent">
            我的会话
          </a>
          <a className="ghost-button full active" href="/agent/stats">
            会话统计
          </a>
        </nav>
        <button
          type="button"
          className="ghost-button full"
          onClick={() => void onLogout()}
        >
          退出客服账号
        </button>
      </aside>

      <main className="agent-statistics-main">
        <header className="agent-statistics-head">
          <div>
            <span className="eyebrow">MY STATISTICS</span>
            <h1>我的会话统计</h1>
            <p>按美国西海岸时间统计首次分配给你的新会话，统计数据保留 45 天。</p>
          </div>
          <label>
            <span>月份</span>
            <input
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
        </header>

        {error && <div className="notice error">{error}</div>}

        <section className="agent-statistics-summary">
          <div>
            <span>本月 1–30 日</span>
            <strong>{busy ? '—' : (stats?.total ?? 0)}</strong>
          </div>
          <div>
            <span>今日接待</span>
            <strong>{busy ? '—' : (stats?.todayCount ?? 0)}</strong>
          </div>
          <div>
            <span>每日上限</span>
            <strong>
              {busy ? '—' : stats?.dailyLimit ? stats.dailyLimit : '不限'}
            </strong>
          </div>
          <div>
            <span>数据保留</span>
            <strong>45 天</strong>
          </div>
        </section>

        <section className="agent-statistics-card">
          <div className="agent-statistics-card-head">
            <div>
              <strong>{month} 每日接待</strong>
              <span>1–30 日；31 日仍参与每日限额，但不计入月表。</span>
            </div>
            <small>
              可查询范围从 {stats?.retainedFrom ?? '—'} 起
            </small>
          </div>
          <div className="agent-statistics-days">
            {days.map((day) => {
              const value = countMap.get(day) ?? 0;
              return (
                <div key={day} className={value ? 'has-value' : ''}>
                  <span>{day} 日</span>
                  <strong>{busy ? '·' : value}</strong>
                </div>
              );
            })}
          </div>
        </section>
      </main>
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

function initials(value: string): string {
  const trimmed = value.trim();
  return trimmed ? [...trimmed].slice(0, 2).join('').toUpperCase() : '客';
}
