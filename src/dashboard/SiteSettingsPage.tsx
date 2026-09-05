import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import type { NoAgentMessageSettings } from './api';
import { NoAgentMessageSettingsPanel } from './NoAgentMessageSettings';
import {
  SITE_LOGO_ACCEPT,
  SITE_LOGO_MAX_EDGE,
  SITE_LOGO_MAX_INPUT_BYTES,
  SITE_LOGO_MAX_UPLOAD_BYTES,
  SITE_LOGO_WEBP_QUALITY,
  prepareSiteLogo,
  type PreparedSiteLogo,
} from './site-logo-image';
import {
  removeSiteLogo,
  uploadSiteLogo,
  type SiteLogoInfo,
} from './site-logo-client';
import { Button } from './ui';

type LogoPhase = 'idle' | 'processing' | 'uploading' | 'saving' | 'removing';

export function SiteSettingsPage({
  noAgentMessage,
  noAgentSaving,
  siteLogo,
  onSiteLogoChange,
  onSaveNoAgentMessage,
}: {
  noAgentMessage: NoAgentMessageSettings;
  noAgentSaving: boolean;
  siteLogo: SiteLogoInfo | null;
  onSiteLogoChange: (siteLogo: SiteLogoInfo | null) => void;
  onSaveNoAgentMessage: (settings: NoAgentMessageSettings) => Promise<void>;
}) {
  return (
    <div className="site-settings-page">
      <SiteLogoSettings siteLogo={siteLogo} onChange={onSiteLogoChange} />
      <section
        className="site-settings-group"
        aria-labelledby="availability-title"
      >
        <header className="site-settings-group-head">
          <div>
            <span className="admin-section-kicker">客服可用性</span>
            <h2 id="availability-title">无客服提示</h2>
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
  siteLogo,
  onChange,
}: {
  siteLogo: SiteLogoInfo | null;
  onChange: (siteLogo: SiteLogoInfo | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef('');
  const [prepared, setPrepared] = useState<PreparedSiteLogo | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [phase, setPhase] = useState<LogoPhase>('idle');
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const busy = phase !== 'idle';
  const activePreview = previewUrl || siteLogo?.url || '';

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setPhase('processing');
    setError('');
    setWarning('');
    try {
      const next = await prepareSiteLogo(file);
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      const objectUrl = URL.createObjectURL(next.blob);
      previewRef.current = objectUrl;
      setPrepared(next);
      setPreviewUrl(objectUrl);
    } catch (reason) {
      setPrepared(null);
      setPreviewUrl('');
      setError(
        reason instanceof Error ? reason.message : '处理站点 Logo 失败。',
      );
    } finally {
      setPhase('idle');
    }
  }

  async function savePreparedLogo() {
    if (!prepared || busy) return;
    setPhase('uploading');
    setError('');
    setWarning('');
    try {
      const result = await uploadSiteLogo(prepared.blob, () => {
        setPhase('saving');
      });
      onChange(result.siteLogo);
      clearPreparedPreview();
      if (result.cleanupWarning) {
        setWarning('新 Logo 已生效，但旧 Logo 对象清理失败；服务端已记录。');
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '上传站点 Logo 失败。',
      );
    } finally {
      setPhase('idle');
    }
  }

  async function removeConfiguredLogo() {
    if (!siteLogo || busy) return;
    setPhase('removing');
    setError('');
    setWarning('');
    try {
      const result = await removeSiteLogo();
      onChange(null);
      clearPreparedPreview();
      if (result.cleanupWarning) {
        setWarning('已恢复默认 CS，但旧 Logo 对象清理失败；服务端已记录。');
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '移除站点 Logo 失败。',
      );
    } finally {
      setPhase('idle');
    }
  }

  function clearPreparedPreview() {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = '';
    setPrepared(null);
    setPreviewUrl('');
  }

  return (
    <section className="site-settings-group" aria-labelledby="branding-title">
      <header className="site-settings-group-head">
        <div>
          <span className="admin-section-kicker">品牌</span>
          <h2 id="branding-title">站点 Logo</h2>
          <p>用于管理后台侧栏品牌标识；未配置时显示默认 CS。</p>
        </div>
      </header>

      <div className="site-logo-setting">
        <div className="site-logo-preview" aria-label="站点 Logo 预览">
          <span aria-hidden="true">CS</span>
          {activePreview ? <img src={activePreview} alt="站点 Logo 预览" /> : null}
        </div>
        <div className="site-logo-copy">
          <strong>{prepared ? '压缩预览' : siteLogo ? '当前 Logo' : '默认品牌标记'}</strong>
          <p>
            PNG / JPG / WebP，原图最大 {formatBytes(SITE_LOGO_MAX_INPUT_BYTES)}；
            保持比例缩放到 {SITE_LOGO_MAX_EDGE} × {SITE_LOGO_MAX_EDGE} 内，优先 WebP
            （质量 {Math.round(SITE_LOGO_WEBP_QUALITY * 100)}%），上传结果不超过{' '}
            {formatBytes(SITE_LOGO_MAX_UPLOAD_BYTES)}。
          </p>
          {prepared ? (
            <small className="site-logo-meta">
              {prepared.width} × {prepared.height} · {formatBytes(prepared.originalBytes)} →{' '}
              {formatBytes(prepared.blob.size)} · {prepared.contentType.replace('image/', '').toUpperCase()}
            </small>
          ) : siteLogo ? (
            <small className="site-logo-meta">
              已保存 · {formatBytes(siteLogo.byteSize)}
            </small>
          ) : null}
          {phase !== 'idle' ? (
            <span className="site-logo-status" role="status">
              {phaseLabel(phase)}
            </span>
          ) : null}
          {error ? (
            <span className="site-logo-error" role="alert">
              {error}
            </span>
          ) : null}
          {warning ? <span className="site-logo-warning">{warning}</span> : null}
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
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {siteLogo ? '替换图片' : '选择图片'}
          </Button>
          {prepared ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void savePreparedLogo()}
              >
                上传 Logo
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={clearPreparedPreview}
              >
                取消
              </Button>
            </>
          ) : null}
          {siteLogo && !prepared ? (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void removeConfiguredLogo()}
            >
              移除
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function phaseLabel(phase: LogoPhase): string {
  if (phase === 'processing') return '正在压缩图片…';
  if (phase === 'uploading') return '正在上传压缩后的 Logo…';
  if (phase === 'saving') return '上传完成，正在保存站点设置…';
  if (phase === 'removing') return '正在恢复默认品牌标记…';
  return '';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}
