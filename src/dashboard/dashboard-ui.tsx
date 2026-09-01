import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Message } from './api';
import {
  agentAttachmentContentUrl,
  agentContactCardHref,
  type AgentMessageAttachment,
} from './agent-attachments-client';
import { AgentContactCardIcon } from './AgentContactCardIcon';
import { formatTime } from './dashboard-runtime';
import { UiIcon } from './icons';
import { Button, Input } from './ui';

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
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onChange(event.target.value)}
            autoFocus
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <Button disabled={!password}>登录管理中心</Button>
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
    <AuthPage title="客服工作台" variant="agent">
      <form
        className="auth-form agent-auth-form"
        onSubmit={onSubmit}
        autoComplete="off"
        data-form-type="other"
      >
        <label>
          客服账号
          <Input
            name="agent-account"
            value={username}
            onChange={(event) => onUsername(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
          />
        </label>
        <label>
          登录密码
          <Input
            type="password"
            name="agent-access-key"
            value={password}
            onChange={(event) => onPassword(event.target.value)}
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <Button
          className="agent-login-button"
          disabled={!username.trim() || !password}
        >
          进入工作台
        </Button>
      </form>
    </AuthPage>
  );
}

function AuthPage({
  eyebrow,
  title,
  description,
  variant = 'default',
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  variant?: 'default' | 'agent';
  children: ReactNode;
}) {
  const agent = variant === 'agent';
  return (
    <div className={`auth-page${agent ? ' agent-auth-page' : ''}`}>
      <div className={`auth-card${agent ? ' agent-auth-card' : ''}`}>
        <div className="auth-mark" aria-hidden="true">
          CS
        </div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
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
      <UiIcon name="clock" />
      {remaining > 0 ? `会话将在 ${clock} 后自动删除` : '会话已到期，正在删除'}
    </span>
  );
}

function Bubble({
  message: item,
  attachments = [],
}: {
  message: Message;
  attachments?: AgentMessageAttachment[];
}) {
  if (item.sender_type === 'system')
    return <div className="system-message">{item.body}</div>;
  const isAgent = item.sender_type === 'agent';
  const isRead = Boolean(item.read_by_visitor_at);
  return (
    <div className={isAgent ? 'message mine' : 'message visitor'}>
      <div>
        {item.body ? <p>{item.body}</p> : null}
        {attachments.length > 0 ? (
          <div className="message-attachments">
            {attachments.map((attachment) => {
              if (attachment.kind === 'image') {
                const url =
                  attachment.url ?? agentAttachmentContentUrl(attachment);
                return url ? (
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    key={attachment.id}
                  >
                    <img
                      className="message-image"
                      src={url}
                      alt={
                        attachment.label ||
                        attachment.originalName ||
                        '聊天图片'
                      }
                      loading="lazy"
                    />
                  </a>
                ) : null;
              }
              return (
                <a
                  className="message-attachment-action"
                  href={agentContactCardHref(attachment)}
                  target={attachment.kind === 'link' ? '_blank' : undefined}
                  rel={attachment.kind === 'link' ? 'noreferrer' : undefined}
                  key={attachment.id}
                >
                  <AgentContactCardIcon
                    id={attachment.id}
                    source="message"
                    hasCustomIcon={attachment.hasCustomIcon}
                  />
                  <span>
                    <strong>{attachment.label}</strong>
                    <small>
                      {attachment.kind === 'phone' ? 'SMS' : '链接'} ·{' '}
                      {attachment.value}
                    </small>
                  </span>
                </a>
              );
            })}
          </div>
        ) : null}
        <span className="message-meta">
          <time>{formatTime(item.created_at)}</time>
          {isAgent ? (
            <span
              className={`delivery-mark${isRead ? ' is-read' : ''}`}
              aria-label={isRead ? '已读' : '已发送'}
              title={isRead ? '已读' : '已发送'}
            >
              <UiIcon name={isRead ? 'check-double' : 'check'} />
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
