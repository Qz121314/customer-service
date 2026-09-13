const WINDOWS_DOWNLOAD_URL =
  'https://github.com/Qz121314/customer-service/releases/latest/download/customer-service-agent-windows-x64.exe';
const WINDOWS_RELEASES_URL =
  'https://github.com/Qz121314/customer-service/releases/latest';

function isWindowsBrowser() {
  return /Windows/u.test(navigator.userAgent);
}

export function AgentWindowsAppSettings() {
  const windows = isWindowsBrowser();

  return (
    <div className="agent-windows-app-settings" role="group" aria-label="Windows 应用">
      <div className="agent-windows-app-copy">
        <i className="is-accent" aria-hidden="true">
          <span className="agent-windows-app-glyph">▣</span>
        </i>
        <span>
          <strong>Windows 客服应用</strong>
          <small>
            {windows
              ? '安装后可常驻后台，及时接收客户消息'
              : 'Windows 电脑可下载桌面版客服工作台'}
          </small>
        </span>
      </div>
      <div className="agent-windows-app-actions">
        <a
          className="mobile-agent-settings-item agent-windows-app-action"
          href={WINDOWS_DOWNLOAD_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span>
            <strong>下载 Windows 应用</strong>
            <small>下载安装包</small>
          </span>
        </a>
        <a
          className="agent-windows-app-action agent-windows-app-update"
          href={WINDOWS_RELEASES_URL}
          target="_blank"
          rel="noreferrer"
        >
          检查更新
        </a>
      </div>
    </div>
  );
}
