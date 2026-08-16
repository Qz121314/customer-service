import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Message } from './api';
import type { AgentMediaItem } from './agent-media';
import { formatTime } from './dashboard-runtime';

type UiIconName =
  | 'agents'
  | 'statistics'
  | 'workspace'
  | 'external'
  | 'logout'
  | 'notification'
  | 'sound';

function UiIcon({ name }: { name: UiIconName }) {
  const paths: Record<UiIconName, ReactNode> = {
    agents: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    statistics: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19V3" />
      </>
    ),
    workspace: (
      <>
        <path d="M4 13a8 8 0 0 1 16 0" />
        <path d="M18 19c0 1.1-.9 2-2 2h-3" />
        <path d="M4 13v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2Z" />
        <path d="M20 13v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z" />
      </>
    ),
    external: (
      <>
        <path d="M15 3h6v6" />
        <path d="m10 14 11-11" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      </>
    ),
    notification: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    sound: (
      <>
        <path d="M11 5 6 9H3v6h3l5 4Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        <path d="M18.5 5.5a9 9 0 0 1 0 13" />
      </>
    ),
  };

  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function AdminLogin({
  password,
  error,
  onChange,
  onSubmit,
}: {
  password: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <AuthPage
      eyebrow="MANAGEMENT"
      title="登录客服管理中心"
      description="管理员负责客服账号和产品接待范围配置。"
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          管理员密码
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button className="primary-button" disabled={!password}>
          登录管理中心
        </button>
        <a className="auth-link" href="/agent">
          我是客服，进入客服登录
        </a>
      </form>
    </AuthPage>
  );
}

function AgentLogin({
  username,
  password,
  error,
  onUsername,
  onPassword,
  onSubmit,
}: {
  username: string;
  password: string;
  error: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <AuthPage
      eyebrow="AGENT WORKSPACE"
      title="客服登录"
      description="所有客服使用同一个入口，登录后只进入自己的会话工作台。"
    >
      <form className="auth-form" onSubmit={onSubmit}>
        <label>
          客服账号
          <input
            value={username}
            onChange={(event) => onUsername(event.target.value)}
            autoComplete="username"
            autoFocus
          />
        </label>
        <label>
          登录密码
          <input
            type="password"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <button
          className="primary-button"
          disabled={!username.trim() || !password}
        >
          进入工作台
        </button>
        <a className="auth-link" href="/">
          返回管理中心
        </a>
      </form>
    </AuthPage>
  );
}

function AuthPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-mark">CS</div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {children}
      </div>
    </div>
  );
}

function AdminSetup() {
  return (
    <AuthPage
      eyebrow="SETUP"
      title="管理中心需要初始化"
      description="在 Cloudflare Worker 中配置 ADMIN_PASSWORD Secret 后即可登录管理中心。"
    >
      <a className="auth-link" href="/agent">
        客服登录入口
      </a>
    </AuthPage>
  );
}

function Startup({ label }: { label: string }) {
  return (
    <div className="startup">
      <div className="auth-mark">CS</div>
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ConversationExpiryCountdown({
  expiresAt,
}: {
  expiresAt: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  const timestamp = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(timestamp)) return null;
  const remaining = Math.max(0, timestamp - now);
  const totalSeconds = Math.ceil(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
  const urgency =
    remaining <= 5 * 60 * 1000
      ? ' is-urgent'
      : remaining <= 60 * 60 * 1000
        ? ' is-warning'
        : '';

  return (
    <span className={`conversation-expiry${urgency}`} aria-live="off">
      <span aria-hidden="true">◷</span>
      {remaining > 0 ? `会话将在 ${clock} 后自动删除` : '会话已到期，正在删除'}
    </span>
  );
}

function Bubble({
  message: item,
  media,
}: {
  message: Message;
  media: AgentMediaItem | null;
}) {
  if (item.sender_type === 'system')
    return <div className="system-message">{item.body}</div>;
  const isAgent = item.sender_type === 'agent';
  const isRead = Boolean(item.read_by_visitor_at);
  return (
    <div className={isAgent ? 'message mine' : 'message visitor'}>
      {!isAgent && <span className="avatar tiny">访</span>}
      <div>
        {media ? (
          <a href={media.url} target="_blank" rel="noreferrer">
            <img
              className="message-image"
              src={media.url}
              alt="聊天图片"
              loading="lazy"
            />
          </a>
        ) : (
          <p>{item.body}</p>
        )}
        <span className="message-meta">
          <time>{formatTime(item.created_at)}</time>
          {isAgent ? (
            <span
              className={`delivery-mark${isRead ? ' is-read' : ''}`}
              aria-label={isRead ? '已读' : '已发送'}
              title={isRead ? '已读' : '已发送'}
            >
              {isRead ? '✓✓' : '✓'}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export {
  UiIcon,
  AdminLogin,
  AgentLogin,
  AdminSetup,
  Startup,
  Metric,
  ConversationExpiryCountdown,
  Bubble,
};
