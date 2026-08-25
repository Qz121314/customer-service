import { useCallback, useEffect, useState } from 'react';
import type { AgentNotificationState } from './agent-push';
import { useAgentPwaInstall } from './agent-install';
import { UiIcon } from './icons';

export function AgentActionToolbar({
  notificationState,
  notificationBusy,
  soundEnabled,
  onToggleNotifications,
  onToggleSound,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
  onOpenMobileSettings,
}: {
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onOpenAutoReply: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
  onOpenMobileSettings: () => void;
}) {
  return (
    <>
      <div className="workspace-sidebar-actions" aria-label="客服工具">
        <button
          type="button"
          className={`ghost-button full workspace-notification-button${notificationState === 'enabled' ? ' is-enabled' : ''}`}
          aria-label={
            notificationState === 'enabled'
              ? '关闭新消息通知'
              : '开启新消息通知'
          }
          title={
            notificationState === 'unsupported'
              ? '当前浏览器不支持后台通知'
              : notificationState === 'blocked'
                ? '通知已被浏览器阻止'
                : notificationState === 'enabled'
                  ? '新消息通知已开启'
                  : '开启新消息通知'
          }
          disabled={notificationBusy || notificationState === 'unsupported'}
          onClick={onToggleNotifications}
        >
          <UiIcon name="notification" />
          <span>
            {notificationBusy
              ? '正在设置…'
              : notificationState === 'enabled'
                ? '新消息通知已开启'
                : notificationState === 'blocked'
                  ? '通知已被阻止'
                  : '开启新消息通知'}
          </span>
        </button>
        <button
          type="button"
          className={`ghost-button full workspace-sound-button${soundEnabled ? ' is-enabled' : ''}`}
          aria-pressed={soundEnabled}
          aria-label={
            soundEnabled ? '关闭前台消息提示音' : '开启前台消息提示音'
          }
          title={soundEnabled ? '前台消息提示音已开启' : '前台消息提示音已静音'}
          onClick={onToggleSound}
        >
          <UiIcon name="sound" />
          <span>{soundEnabled ? '前台提示音已开启' : '前台提示音已静音'}</span>
        </button>
        <button
          type="button"
          className="ghost-button full workspace-auto-reply-button"
          aria-label="打开自动回复设置"
          title="自动回复"
          onClick={onOpenAutoReply}
        >
          <UiIcon name="auto-reply" />
          <span>自动回复</span>
        </button>
        <button
          type="button"
          className="ghost-button full workspace-statistics-button"
          aria-label="打开接待流量"
          title="接待流量"
          onClick={onOpenStatistics}
        >
          <UiIcon name="statistics" />
          <span>接待流量</span>
        </button>
        <button
          type="button"
          className="ghost-button full workspace-logout-button"
          aria-label="退出客服账号"
          title="退出客服账号"
          onClick={onLogout}
        >
          <UiIcon name="logout" />
          <span>退出客服账号</span>
        </button>
      </div>
      <button
        type="button"
        className="ghost-button mobile-settings-trigger"
        aria-label="打开功能菜单"
        title="功能菜单"
        onClick={onOpenMobileSettings}
      >
        <UiIcon name="settings" />
      </button>
    </>
  );
}

export function AgentMobileSettingsPage({
  open,
  notificationState,
  notificationBusy,
  soundEnabled,
  onClose,
  onToggleNotifications,
  onToggleSound,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
}: {
  open: boolean;
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  onClose: () => void;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onOpenAutoReply: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
}) {
  const { state: installState, install } = useAgentPwaInstall();
  const [showManualInstall, setShowManualInstall] = useState(false);

  const close = useCallback(() => {
    setShowManualInstall(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [close, open]);

  if (!open) return null;

  const installLabel =
    installState === 'installed'
      ? '已安装到手机'
      : installState === 'available'
        ? '安装到手机'
        : '添加到手机主屏幕';
  const installDescription =
    installState === 'installed'
      ? '当前已作为独立应用运行'
      : installState === 'available'
        ? '获得更接近 App 的全屏体验'
        : '通过浏览器菜单完成安装';

  const openInstall = async () => {
    if (installState === 'installed') return;
    try {
      const result = await install();
      setShowManualInstall(result === 'manual' || result === 'dismissed');
    } catch {
      setShowManualInstall(true);
    }
  };

  const openAndClose = (action: () => void) => {
    close();
    action();
  };

  return (
    <section
      className="mobile-agent-settings-page"
      aria-labelledby="mobile-agent-settings-title"
    >
      <header className="mobile-agent-settings-head">
        <button type="button" aria-label="返回工作台" onClick={close}>
          <UiIcon name="back" />
        </button>
        <div>
          <span>WORKSPACE</span>
          <h1 id="mobile-agent-settings-title">功能菜单</h1>
        </div>
      </header>

      <div className="mobile-agent-settings-content">
        <div className="mobile-agent-settings-group">
          <span className="mobile-agent-settings-label">应用</span>
          <button
            type="button"
            className="mobile-agent-settings-item"
            aria-label="安装到手机"
            disabled={installState === 'installed'}
            onClick={() => void openInstall()}
          >
            <i className="is-accent" aria-hidden="true">
              <UiIcon name="install" />
            </i>
            <span>
              <strong>{installLabel}</strong>
              <small>{installDescription}</small>
            </span>
            {installState !== 'installed' && <UiIcon name="chevron" />}
          </button>
          {showManualInstall && (
            <p className="mobile-agent-install-help" role="status">
              打开浏览器菜单或分享菜单，选择“添加到主屏幕”。
            </p>
          )}
        </div>

        <div className="mobile-agent-settings-group">
          <span className="mobile-agent-settings-label">接待设置</span>
          <button
            type="button"
            className={`mobile-agent-settings-item${notificationState === 'enabled' ? ' is-enabled' : ''}`}
            disabled={notificationBusy || notificationState === 'unsupported'}
            onClick={onToggleNotifications}
          >
            <i aria-hidden="true">
              <UiIcon name="notification" />
            </i>
            <span>
              <strong>新消息通知</strong>
              <small>
                {notificationBusy
                  ? '正在设置…'
                  : notificationState === 'enabled'
                    ? '已开启'
                    : notificationState === 'blocked'
                      ? '已被浏览器阻止'
                      : notificationState === 'unsupported'
                        ? '当前浏览器不支持'
                        : '未开启'}
              </small>
            </span>
            <b aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`mobile-agent-settings-item${soundEnabled ? ' is-enabled' : ''}`}
            onClick={onToggleSound}
          >
            <i aria-hidden="true">
              <UiIcon name="sound" />
            </i>
            <span>
              <strong>前台提示音</strong>
              <small>{soundEnabled ? '已开启' : '已静音'}</small>
            </span>
            <b aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mobile-agent-settings-item"
            onClick={() => openAndClose(onOpenAutoReply)}
          >
            <i aria-hidden="true">
              <UiIcon name="auto-reply" />
            </i>
            <span>
              <strong>首次问候语</strong>
              <small>设置首次接待时自动发送的内容</small>
            </span>
            <UiIcon name="chevron" />
          </button>
        </div>

        <div className="mobile-agent-settings-group">
          <span className="mobile-agent-settings-label">工作台</span>
          <button
            type="button"
            className="mobile-agent-settings-item"
            onClick={() => openAndClose(onOpenStatistics)}
          >
            <i aria-hidden="true">
              <UiIcon name="statistics" />
            </i>
            <span>
              <strong>接待流量</strong>
              <small>查看个人自然月接待数据</small>
            </span>
            <UiIcon name="chevron" />
          </button>
        </div>

        <button
          type="button"
          className="mobile-agent-settings-logout"
          onClick={onLogout}
        >
          <UiIcon name="logout" />
          退出客服账号
        </button>
      </div>
    </section>
  );
}
