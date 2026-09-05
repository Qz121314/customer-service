import { useRef, useState, type ChangeEvent } from 'react';
import type { NoAgentMessageSettings } from './api';
import { NoAgentMessageSettingsPanel } from './NoAgentMessageSettings';
import {
  SITE_LOGO_ACCEPT,
  SITE_LOGO_MAX_LABEL,
  removeSiteLogo,
  siteLogoUrl,
  uploadSiteLogo,
} from './site-logo-client';
import { Button } from './ui';

export function SiteSettingsPage({
  noAgentMessage,
  noAgentSaving,
  logoRevision,
  onLogoRevisionChange,
  onSaveNoAgentMessage,
}: {
  noAgentMessage: NoAgentMessageSettings;
  noAgentSaving: boolean;
  logoRevision: string;
  onLogoRevisionChange: (revision: string) => void;
  onSaveNoAgentMessage: (settings: NoAgentMessageSettings) => Promise<void>;
}) {
  return (
    <div className="site-settings-page">
      <SiteLogoSettings
        revision={logoRevision}
        onRevisionChange={onLogoRevisionChange}
      />
      <section className="site-settings-group" aria-labelledby="availability-title">
        <header className="site-settings-group-head">
          <div>
            <span className="admin-section-kicker">客服可用性</span>
            <h2 id="availability-title">访客侧客服体验</h2>
            <p>管理没有可分配客服时，访客立即看到的响应内容。</p>
          </div>
        </header>
        <NoAgentMessageSettingsPanel
          settings={noAgentMessage}
          saving={noAgentSaving}
          onSave={onSaveNoAgentMessage}
        />
      </section>
    </div>
  );
}

function SiteLogoSettings({
  revision,
  onRevisionChange,
}: {
  revision: string;
  onRevisionChange: (revision: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const nextRevision = await uploadSiteLogo(file);
      setPreviewFailed(false);
      onRevisionChange(nextRevision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '上传站点 Logo 失败。');
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefault() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const nextRevision = await removeSiteLogo();
      setPreviewFailed(true);
      onRevisionChange(nextRevision);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '移除站点 Logo 失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="site-settings-group" aria-labelledby="branding-title">
      <header className="site-settings-group-head">
        <div>
          <span className="admin-section-kicker">品牌</span>
          <h2 id="branding-title">站点品牌</h2>
          <p>设置管理员后台侧栏使用的站点 Logo；未配置时继续显示默认 CS 标记。</p>
        </div>
      </header>

      <div className="site-logo-setting">
        <div className="site-logo-preview" aria-label="当前站点 Logo">
          <span aria-hidden="true">CS</span>
          {!previewFailed ? (
            <img
              key={revision || 'default'}
              src={siteLogoUrl(revision)}
              alt="当前站点 Logo"
              onLoad={() => setPreviewFailed(false)}
              onError={() => setPreviewFailed(true)}
            />
          ) : null}
        </div>
        <div className="site-logo-copy">
          <strong>站点 Logo</strong>
          <p>PNG、JPG 或 WebP，最大 {SITE_LOGO_MAX_LABEL}。建议使用清晰的方形或横向品牌图。</p>
          {error ? <span className="site-logo-error" role="alert">{error}</span> : null}
        </div>
        <div className="site-logo-actions">
          <input
            ref={inputRef}
            className="site-logo-file-input"
            type="file"
            accept={SITE_LOGO_ACCEPT}
            disabled={busy}
            onChange={(event) => void onFileChange(event)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? '处理中…' : previewFailed ? '上传 Logo' : '替换 Logo'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || previewFailed}
            onClick={() => void restoreDefault()}
          >
            恢复默认
          </Button>
        </div>
      </div>
    </section>
  );
}
