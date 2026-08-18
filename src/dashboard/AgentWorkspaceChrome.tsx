import type { AgentNotificationState } from './agent-push';
import { UiIcon } from './dashboard-ui';

export function AgentActionToolbar({
  notificationState,
  notificationBusy,
  soundEnabled,
  onToggleNotifications,
  onToggleSound,
  onOpenStatistics,
  onLogout,
}: {
  notificationState: AgentNotificationState;
  notificationBusy: boolean;
  soundEnabled: boolean;
  onToggleNotifications: () => void;
  onToggleSound: () => void;
  onOpenStatistics: () => void;
  onLogout: () => void;
}) {
  return (
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
  );
}
