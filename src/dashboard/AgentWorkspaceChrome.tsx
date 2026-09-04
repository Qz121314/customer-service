import { useCallback, useEffect, useState } from 'react';
import type { AgentNotificationState } from './agent-push';
import { useAgentPwaInstall } from './agent-install';
import {
  AGENT_SOUND_PRESET_OPTIONS,
  loadAgentSoundPreset,
  saveAgentSoundPreset,
  type AgentSoundPreset,
} from './dashboard-runtime';
import { UiIcon } from './icons';
import { Button } from './ui';

export function AgentActionToolbar({
  notificationState,
  notificationBusy,
  soundEnabled,
  onToggleNotifications,
  onToggleSound,
  onOpenCardSettings,
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
          className="full workspace-card-settings-button"
          aria-label="打开名片设置"
          title="名片"
          onClick={onOpenCardSettings}
        >
          <UiIcon name="contact" />
          <span>名片</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`full workspace-notification-button${notificationState === 'enabled' ? ' is-enabled' : ''}`}
          aria-label={
            notificationState === 'enabled'
              ? '关闭客户消息通知'
              : '开启客户消息通知'
          }
          title={
            notificationState === 'unsupported'
              ? '当前浏览器不支持系统通知'
              : notificationState === 'install-required'
                ? '请先添加到主屏幕，再从桌面打开并开启通知'
                : notificationState === 'blocked'
                  ? '通知已被浏览器阻止'
                  : notificationState === 'enabled'
                    ? '客户消息通知已开启'
                    : '开启客户消息通知'
          }
          disabled={notificationBusy || notificationState === 'unsupported'}
          onClick={onToggleNotifications}
        >
          <UiIcon name="notification" />
          <span>
            {notificationBusy
              ? '正在设置…'
              : notificationState === 'enabled'
                ? '客户消息通知已开启'
                : notificationState === 'install-required'
                  ? '添加到主屏幕后开启通知'
                  : notificationState === 'blocked'
                    ? '通知已被阻止'
                    : '开启客户消息通知'}
          </span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          className={`full workspace-sound-button${soundEnabled ? ' is-enabled' : ''}`}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? '关闭消息提示音' : '开启消息提示音'}
          title={soundEnabled ? '消息提示音已开启' : '消息提示音已关闭'}
          onClick={onToggleSound}
        >
          <UiIcon name="sound" />
          <span>{soundEnabled ? '消息提示音已开启' : '消息提示音已关闭'}</span>
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

function AgentReminderToggleActions({
  enabled,
  toggleLabel,
  testLabel,
  onToggle,
  onTest,
}: {
  enabled: boolean;
  toggleLabel: string;
  testLabel: string;
  onToggle: () => void;
  onTest: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        aria-label={toggleLabel}
        aria-pressed={enabled}
        onClick={onToggle}
        style={{
          position: 'relative',
          width: 38,
          minWidth: 38,
          height: 22,
          padding: 0,
          border: 0,
          borderRadius: 999,
          background: enabled ? 'var(--mobile-accent)' : '#dfe3e8',
          transition: 'background 140ms ease',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 3,
            left: 3,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(15, 23, 42, 0.16)',
            transform: enabled ? 'translateX(16px)' : 'none',
            transition: 'transform 140ms ease',
          }}
        />
      </button>
      <button
        type="button"
        className="secondary-button"
        aria-label={testLabel}
        onClick={onTest}
        style={{
          minWidth: 44,
          minHeight: 30,
          padding: '0 10px',
          borderRadius: 9,
          color: 'var(--mobile-accent-strong)',
          fontSize: 10,
          fontWeight: 720,
        }}
      >
        测试
      </button>
    </div>
  );
}

export function AgentMobileSettingsPage({
  open,
  notificationState,
  notificationBusy,
  soundEnabled,
  vibrationEnabled,
  vibrationSupported,
  realtimeReady,
  audioReady,
  onClose,
  onToggleNotifications,
  onToggleSound,
  onToggleVibration,
  onTestSound,
  onTestVibration,
  onOpenCardSettings,
  onOpenAutoReply,
  onOpenStatistics,
  onLogout,
}: {
  open: boolean;
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  vibrationSupported: boolean;
  realtimeReady: boolean;
  audioReady: boolean;
  onClose: () => void;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onToggleVibration: () => void;
  onTestSound: () => void;
  onTestVibration: () => void;
  onOpenCardSettings: () => void;
  onOpenAutoReply: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
}) {
  const { state: installState, install } = useAgentPwaInstall();
  const [showManualInstall, setShowManualInstall] = useState(false);
  const [soundPreset, setSoundPreset] = useState<AgentSoundPreset>(() =>
    loadAgentSoundPreset(),
  );

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
  const notificationsReady = notificationState === 'enabled';
  const pwaReady = installState === 'installed';
  const audioStateReady = !soundEnabled || audioReady;
  const reminderReady = realtimeReady && notificationsReady && audioStateReady;
  const soundReady = soundEnabled && audioReady;
  const soundPresetLabel =
    AGENT_SOUND_PRESET_OPTIONS.find((option) => option.id === soundPreset)
      ?.label ?? '强提醒';

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

  const changeSoundPreset = (value: string) => {
    const nextPreset = AGENT_SOUND_PRESET_OPTIONS.find(
      (option) => option.id === value,
    )?.id;
    if (!nextPreset) return;
    setSoundPreset(nextPreset);
    saveAgentSoundPreset(nextPreset);
    onTestSound();
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
                <dt>系统通知</dt>
                <dd>
                  <AgentHealthState
                    ready={notificationsReady}
                    label={notificationsReady ? '已开启' : '未开启'}
                  />
                </dd>
              </div>
              <div>
                <dt>后台 Push</dt>
                <dd>
                  <AgentHealthState
                    ready={notificationsReady}
                    label={notificationsReady ? '已订阅' : '不可用'}
                  />
                </dd>
              </div>
              <div>
                <dt>提示音</dt>
                <dd>
                  <AgentHealthState
                    ready={soundReady}
                    label={
                      !soundEnabled
                        ? '已关闭'
                        : audioReady
                          ? '已开启'
                          : '待解锁'
                    }
                  />
                </dd>
              </div>
              {vibrationSupported && (
                <div>
                  <dt>震动</dt>
                  <dd>
                    <AgentHealthState
                      ready={vibrationEnabled}
                      label={vibrationEnabled ? '已开启' : '已关闭'}
                    />
                  </dd>
                </div>
              )}
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
            {!notificationsReady && (
              <p>锁屏或切后台后可能无法收到客户消息提醒。</p>
            )}
          </div>
        </section>

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
                <strong>客户消息通知</strong>
                <small>
                  {notificationBusy
                    ? '正在设置…'
                    : notificationState === 'enabled'
                      ? '已开启 · 切后台、锁屏或离开页面也会提醒'
                      : notificationState === 'install-required'
                        ? 'iPhone/iPad 请先添加到主屏幕'
                        : notificationState === 'blocked'
                          ? '已被浏览器阻止'
                          : notificationState === 'unsupported'
                            ? '当前浏览器不支持'
                            : '每条客户消息到达时显示系统通知'}
                </small>
              </span>
              <b aria-hidden="true" />
            </button>
            <div className="mobile-agent-settings-item">
              <i aria-hidden="true">
                <UiIcon name="sound" />
              </i>
              <span>
                <strong>消息提示音</strong>
                <small>
                  {soundEnabled
                    ? `已开启 · ${soundPresetLabel}`
                    : '已关闭 · 不播放工作台提示音'}
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
                <select
                  aria-label="选择消息提示音"
                  value={soundPreset}
                  onChange={(event) => changeSoundPreset(event.target.value)}
                  style={{
                    width: 118,
                    maxWidth: '32vw',
                    minHeight: 30,
                    border: '1px solid var(--mobile-border)',
                    borderRadius: 9,
                    background: '#fff',
                    padding: '0 7px',
                    color: 'var(--mobile-text)',
                    fontSize: 10,
                    fontWeight: 680,
                  }}
                >
                  {AGENT_SOUND_PRESET_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <AgentReminderToggleActions
                  enabled={soundEnabled}
                  toggleLabel={
                    soundEnabled ? '关闭消息提示音' : '开启消息提示音'
                  }
                  testLabel="测试提示音"
                  onToggle={onToggleSound}
                  onTest={onTestSound}
                />
              </div>
            </div>
            {vibrationSupported && (
              <div className="mobile-agent-settings-item">
                <i aria-hidden="true">
                  <UiIcon name="notification" />
                </i>
                <span>
                  <strong>震动提醒</strong>
                  <small>
                    {vibrationEnabled
                      ? '已开启 · 工作台前台时每条客户消息都会震动'
                      : '已关闭 · 不触发工作台震动'}
                  </small>
                </span>
                <AgentReminderToggleActions
                  enabled={vibrationEnabled}
                  toggleLabel={
                    vibrationEnabled ? '关闭震动提醒' : '开启震动提醒'
                  }
                  testLabel="测试震动"
                  onToggle={onToggleVibration}
                  onTest={onTestVibration}
                />
              </div>
            )}
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
