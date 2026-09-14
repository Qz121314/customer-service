import { useCallback, useEffect, useState } from 'react';
import { useAgentPwaInstall } from './agent-install';
import { UiIcon } from './icons';
import { Button } from './ui';

const WINDOWS_DOWNLOAD_URL =
  'https://github.com/Qz121314/customer-service/releases/latest/download/customer-service-agent-windows-x64.exe';
const ANDROID_DOWNLOAD_URL =
  'https://github.com/Qz121314/customer-service/releases/latest/download/customer-service-agent-android.apk';

export function AgentActionToolbar({
  soundEnabled,
  onToggleSound,
  onOpenCardSettings,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
  onOpenMobileSettings,
}: {
  soundEnabled: boolean;
  onToggleSound: () => void;
  onOpenCardSettings: () => void;
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
          className={`full workspace-sound-button${soundEnabled ? ' is-enabled' : ''}`}
          aria-label={soundEnabled ? '关闭消息提示音' : '开启消息提示音'}
          aria-pressed={soundEnabled}
          title={soundEnabled ? '关闭消息提示音' : '开启消息提示音'}
          data-tooltip={soundEnabled ? '关闭消息提示音' : '开启消息提示音'}
          onClick={onToggleSound}
        >
          <UiIcon name="sound" />
          <span>{soundEnabled ? '消息提示音已开启' : '开启消息提示音'}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-auto-reply-button"
          aria-label="打开自动回复设置"
          title="自动回复"
          data-tooltip="自动回复"
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
          data-tooltip="接待流量"
          onClick={onOpenStatistics}
        >
          <UiIcon name="statistics" />
          <span>接待流量</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-card-settings-button"
          aria-label="打开名片设置"
          title="名片"
          data-tooltip="名片"
          onClick={onOpenCardSettings}
        >
          <UiIcon name="contact" />
          <span>名片</span>
        </Button>
        <span className="workspace-sidebar-divider" aria-hidden="true" />
        <Button
          asChild
          variant="ghost"
          className="full workspace-windows-app-button"
        >
          <a
            href={WINDOWS_DOWNLOAD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="下载/更新客服应用"
            title="下载/更新客服应用"
            data-tooltip="下载/更新客服应用"
          >
            <UiIcon name="install" />
            <span>下载/更新客服应用</span>
          </a>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="full workspace-logout-button"
          aria-label="退出客服账号"
          title="退出客服账号"
          data-tooltip="退出客服账号"
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

function AgentHealthState({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        color: ready ? '#2f9d70' : '#c45454',
        fontWeight: 720,
      }}
    >
      <UiIcon name={ready ? 'check' : 'close'} />
      <span>{label}</span>
    </span>
  );
}

export function AgentMobileSettingsPage({
  open,
  realtimeReady,
  audioReady,
  soundEnabled,
  reminderPending,
  onClose,
  onToggleSound,
  onOpenCardSettings,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
}: {
  open: boolean;
  realtimeReady: boolean;
  audioReady: boolean;
  soundEnabled: boolean;
  reminderPending: boolean;
  onClose: () => void;
  onToggleSound: () => void;
  onOpenCardSettings: () => void;
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
  const pwaReady = installState === 'installed';
  const soundReady = soundEnabled && (audioReady || realtimeReady);
  const reminderReady = realtimeReady && soundEnabled && !reminderPending;

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
          <h2 className="mobile-agent-settings-label">消息提醒</h2>
          <div className="agent-notification-health" role="status">
            <strong>
              <AgentHealthState
                ready={reminderReady}
                label={`消息提醒：${reminderReady ? '正常' : '需检查'}`}
              />
            </strong>
            <dl>
              <div>
                <dt>实时连接</dt>
                <dd>
                  <AgentHealthState
                    ready={realtimeReady}
                    label={realtimeReady ? '正常' : '连接中'}
                  />
                </dd>
              </div>
              <div>
                <dt>消息提示音</dt>
                <dd>
                  <AgentHealthState
                    ready={soundReady}
                    label={soundEnabled ? '已开启' : '已关闭'}
                  />
                </dd>
              </div>
              <div>
                <dt>PWA</dt>
                <dd>
                  <AgentHealthState
                    ready={pwaReady}
                    label={pwaReady ? '已安装' : '建议安装'}
                  />
                </dd>
              </div>
            </dl>
            {reminderPending && (
              <p role="status">
                消息提示音暂未成功，将在下一次消息或页面交互时重试。
              </p>
            )}
          </div>
        </section>

        <section className="mobile-agent-settings-group">
          <h2 className="mobile-agent-settings-label">设备与提醒</h2>
          <div className="mobile-agent-settings-card">
            <a
              className="mobile-agent-settings-item"
              href={ANDROID_DOWNLOAD_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="下载安卓客服端"
            >
              <i className="is-accent" aria-hidden="true">
                <UiIcon name="install" />
              </i>
              <span>
                <strong>下载安卓客服端</strong>
                <small>安装 Android 客服坐席应用</small>
              </span>
              <UiIcon name="chevron" />
            </a>
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
            <div className="mobile-agent-settings-item">
              <i aria-hidden="true">
                <UiIcon name="sound" />
              </i>
              <span>
                <strong>消息提示音</strong>
                <small>
                  {soundEnabled
                    ? '使用设备音量播放强提醒音'
                    : '已关闭，不播放客户消息提示音'}
                </small>
              </span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <button
                  type="button"
                  className={`secondary-button${soundEnabled ? '' : ' is-muted'}`}
                  aria-label={
                    soundEnabled ? '关闭消息提示音' : '开启消息提示音'
                  }
                  onClick={onToggleSound}
                >
                  {soundEnabled ? '关闭' : '开启'}
                </button>
              </div>
            </div>
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
              onClick={() => openChild(onOpenCardSettings)}
            >
              <i aria-hidden="true">
                <UiIcon name="contact" />
              </i>
              <span>
                <strong>名片</strong>
                <small>添加聊天和问候语使用的手机号或链接</small>
              </span>
              <UiIcon name="chevron" />
            </button>
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
