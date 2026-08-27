import { useCallback, useEffect, useState } from 'react';
import type { AgentNotificationState } from './agent-push';
import { useAgentPwaInstall } from './agent-install';
import { UiIcon } from './icons';
import { Button } from './ui';

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
        <Button
          type="button"
          variant="ghost"
          className={`full workspace-notification-button${notificationState === 'enabled' ? ' is-enabled' : ''}`}
          aria-label={
            notificationState === 'enabled'
              ? '关闭新会话通知'
              : '开启新会话通知'
          }
          title={
            notificationState === 'unsupported'
              ? '当前浏览器不支持系统通知'
              : notificationState === 'install-required'
                ? '请先添加到主屏幕，再从桌面打开并开启通知'
                : notificationState === 'blocked'
                  ? '通知已被浏览器阻止'
                  : notificationState === 'enabled'
                    ? '新会话通知已开启'
                    : '开启新会话通知'
          }
          disabled={notificationBusy || notificationState === 'unsupported'}
          onClick={onToggleNotifications}
        >
          <UiIcon name="notification" />
          <span>
            {notificationBusy
              ? '正在设置…'
              : notificationState === 'enabled'
                ? '新会话通知已开启'
                : notificationState === 'install-required'
                  ? '添加到主屏幕后开启通知'
                  : notificationState === 'blocked'
                    ? '通知已被阻止'
                    : '开启新会话通知'}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`full workspace-sound-button${soundEnabled ? ' is-enabled' : ''}`}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? '关闭工作台提示音' : '开启工作台提示音'}
          title={soundEnabled ? '工作台提示音已开启' : '工作台提示音已静音'}
          onClick={onToggleSound}
        >
          <UiIcon name="sound" />
          <span>
            {soundEnabled ? '工作台提示音已开启' : '工作台提示音已静音'}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-auto-reply-button"
          aria-label="打开自动回复设置"
          title="自动回复"
          onClick={onOpenAutoReply}
        >
          <UiIcon name="auto-reply" />
          <span>自动回复</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-statistics-button"
          aria-label="打开接待流量"
          title="接待流量"
          onClick={onOpenStatistics}
        >
          <UiIcon name="statistics" />
          <span>接待流量</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-logout-button"
          aria-label="退出客服账号"
          title="退出客服账号"
          onClick={onLogout}
        >
          <UiIcon name="logout" />
          <span>退出客服账号</span>
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="mobile-settings-trigger"
        aria-label="打开功能菜单"
        title="功能菜单"
        onClick={onOpenMobileSettings}
      >
        <UiIcon name="settings" />
      </Button>
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
      if (event.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      close();
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

  const openInstall = () => {
    if (installState === 'installed') return;
    void Promise.resolve(install())
      .then((result) => {
        setShowManualInstall(result === 'manual' || result === 'dismissed');
      })
      .catch(() => {
        setShowManualInstall(true);
      });
  };

  const openChild = (action: () => void) => {
    setShowManualInstall(false);
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
        <h1 id="mobile-agent-settings-title">功能菜单</h1>
      </header>

      <div className="mobile-agent-settings-content">
        <section className="mobile-agent-settings-group">
          <h2 className="mobile-agent-settings-label">设备与提醒</h2>
          <div className="mobile-agent-settings-card">
            <button
              type="button"
              className="mobile-agent-settings-item"
              aria-label="安装到手机"
              disabled={installState === 'installed'}
              onClick={openInstall}
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
                <strong>新会话通知</strong>
                <small>
                  {notificationBusy
                    ? '正在设置…'
                    : notificationState === 'enabled'
                      ? '已开启 · 切换应用或锁屏也会提醒'
                      : notificationState === 'install-required'
                        ? 'iPhone/iPad 请先添加到主屏幕'
                        : notificationState === 'blocked'
                          ? '已被浏览器阻止'
                          : notificationState === 'unsupported'
                            ? '当前浏览器不支持'
                            : '接到新会话时显示系统通知'}
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
                <strong>工作台提示音</strong>
                <small>
                  {soundEnabled ? '已开启 · 工作台打开时响铃' : '已静音'}
                </small>
              </span>
              <b aria-hidden="true" />
            </button>
          </div>
          {showManualInstall && (
            <p className="mobile-agent-install-help" role="status">
              打开浏览器菜单或分享菜单，选择“添加到主屏幕”。
            </p>
          )}
        </section>

        <section className="mobile-agent-settings-group">
          <h2 className="mobile-agent-settings-label">接待</h2>
          <div className="mobile-agent-settings-card">
            <button
              type="button"
              className="mobile-agent-settings-item"
              onClick={() => openChild(onOpenAutoReply)}
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
            <button
              type="button"
              className="mobile-agent-settings-item"
              onClick={() => openChild(onOpenStatistics)}
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
        </section>

        <section className="mobile-agent-settings-group is-account">
          <h2 className="mobile-agent-settings-label">账号</h2>
          <button
            type="button"
            className="mobile-agent-settings-logout"
            onClick={onLogout}
          >
            <UiIcon name="logout" />
            <span>
              <strong>退出客服账号</strong>
              <small>退出当前设备上的客服登录</small>
            </span>
            <UiIcon name="chevron" />
          </button>
        </section>
      </div>
    </section>
  );
}
