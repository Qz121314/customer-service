import { useEffect, useState } from 'react';
import type { AgentNotificationState } from './agent-push';
import {
  getAgentInstallCapability,
  promptAgentInstall,
  subscribeAgentInstallCapability,
  type AgentInstallCapability,
} from './agent-pwa-install';
import { UiIcon } from './dashboard-ui';

export function AgentMobileSettings({
  notificationState,
  notificationBusy,
  soundEnabled,
  onToggleNotifications,
  onToggleSound,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
}: {
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onOpenAutoReply: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [installCapability, setInstallCapability] =
    useState<AgentInstallCapability>(() => getAgentInstallCapability());
  const [installGuide, setInstallGuide] = useState<'ios' | 'manual' | null>(
    null,
  );

  useEffect(
    () =>
      subscribeAgentInstallCapability(() => {
        setInstallCapability(getAgentInstallCapability());
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (installCapability === 'installed') setInstallGuide(null);
  }, [installCapability]);

  const notificationLabel = notificationBusy
    ? '正在设置…'
    : notificationState === 'enabled'
      ? '已开启'
      : notificationState === 'blocked'
        ? '已阻止'
        : notificationState === 'unsupported'
          ? '不支持'
          : '未开启';

  const openAutoReply = () => {
    setOpen(false);
    onOpenAutoReply();
  };

  const openStatistics = () => {
    setOpen(false);
    onOpenStatistics();
  };

  const logout = () => {
    setOpen(false);
    onLogout();
  };

  const install = async () => {
    if (installCapability === 'prompt') {
      const outcome = await promptAgentInstall();
      if (outcome === 'accepted') {
        setOpen(false);
        return;
      }
    }
    setInstallGuide(installCapability === 'ios' ? 'ios' : 'manual');
  };

  return (
    <div className="agent-mobile-settings">
      <button
        type="button"
        className="agent-mobile-settings-trigger"
        aria-label="打开工作台设置"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <SettingsIcon />
      </button>

      {open ? (
        <div
          className="agent-mobile-settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="agent-mobile-settings-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-mobile-settings-title"
          >
            <div className="agent-mobile-settings-handle" aria-hidden="true" />
            <header className="agent-mobile-settings-head">
              <div>
                <span>工作台</span>
                <h2 id="agent-mobile-settings-title">设置</h2>
              </div>
              <button
                type="button"
                aria-label="关闭工作台设置"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>

            <div className="agent-mobile-settings-list">
              <button
                type="button"
                className="agent-mobile-settings-row"
                disabled={
                  notificationBusy || notificationState === 'unsupported'
                }
                onClick={onToggleNotifications}
              >
                <span className="agent-mobile-settings-icon">
                  <UiIcon name="notification" />
                </span>
                <span className="agent-mobile-settings-copy">
                  <strong>新消息通知</strong>
                  <small>锁屏或切到后台时接收新会话提醒</small>
                </span>
                <span
                  className={`agent-mobile-settings-value${notificationState === 'enabled' ? ' is-enabled' : ''}`}
                >
                  {notificationLabel}
                </span>
              </button>

              <button
                type="button"
                className="agent-mobile-settings-row"
                onClick={onToggleSound}
              >
                <span className="agent-mobile-settings-icon">
                  <UiIcon name="sound" />
                </span>
                <span className="agent-mobile-settings-copy">
                  <strong>消息提示音</strong>
                  <small>工作台在前台时播放新消息提示音</small>
                </span>
                <span
                  className={`agent-mobile-settings-value${soundEnabled ? ' is-enabled' : ''}`}
                >
                  {soundEnabled ? '已开启' : '已静音'}
                </span>
              </button>

              <button
                type="button"
                className="agent-mobile-settings-row"
                onClick={openAutoReply}
              >
                <span className="agent-mobile-settings-icon">
                  <AutoReplyIcon />
                </span>
                <span className="agent-mobile-settings-copy">
                  <strong>自动回复</strong>
                  <small>设置首次分配会话时发送的问候语</small>
                </span>
                <ChevronIcon />
              </button>

              <button
                type="button"
                className="agent-mobile-settings-row"
                onClick={openStatistics}
              >
                <span className="agent-mobile-settings-icon">
                  <UiIcon name="statistics" />
                </span>
                <span className="agent-mobile-settings-copy">
                  <strong>接待流量</strong>
                  <small>查看自己的接待统计</small>
                </span>
                <ChevronIcon />
              </button>

              {installCapability !== 'installed' ? (
                <>
                  <button
                    type="button"
                    className="agent-mobile-settings-row"
                    onClick={() => void install()}
                  >
                    <span className="agent-mobile-settings-icon">
                      <InstallIcon />
                    </span>
                    <span className="agent-mobile-settings-copy">
                      <strong>安装客服工作台</strong>
                      <small>添加到主屏幕，获得更接近 App 的使用体验</small>
                    </span>
                    <ChevronIcon />
                  </button>
                  {installGuide ? (
                    <div
                      className="agent-mobile-install-guide"
                      role="status"
                    >
                      <strong>安装方法</strong>
                      <span>
                        {installGuide === 'ios'
                          ? '在 Safari 中点击分享按钮，然后选择“添加到主屏幕”。'
                          : '打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。'}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : null}

              <button
                type="button"
                className="agent-mobile-settings-row is-danger"
                onClick={logout}
              >
                <span className="agent-mobile-settings-icon">
                  <UiIcon name="logout" />
                </span>
                <span className="agent-mobile-settings-copy">
                  <strong>退出登录</strong>
                  <small>退出当前客服账号</small>
                </span>
                <ChevronIcon />
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SettingsIcon() {
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1a1.7 1.7 0 0 0-1.7 1.6Z" />
    </svg>
  );
}

function AutoReplyIcon() {
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
      <path d="M7 8h10a4 4 0 0 1 4 4v5" />
      <path d="m7 4-4 4 4 4" />
      <path d="M17 16h4v4" />
    </svg>
  );
}

function InstallIcon() {
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
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="agent-mobile-settings-chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
