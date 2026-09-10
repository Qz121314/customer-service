import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { NoAgentMessageSettings } from './api';
import { NoAgentMessageSettingsPanel } from './NoAgentMessageSettings';
import { SITE_LOGO_ACCEPT, prepareSiteLogo } from './site-logo-image';
import { uploadSiteLogo, type SiteLogoInfo } from './site-logo-client';

type LogoPhase = 'idle' | 'processing' | 'uploading' | 'saving';

export function SiteSettingsPage({
  view,
  noAgentMessage,
  noAgentSaving,
  onSaveNoAgentMessage,
}: {
  view: 'availability';
  noAgentMessage: NoAgentMessageSettings;
  noAgentSaving: boolean;
  onSaveNoAgentMessage: (settings: NoAgentMessageSettings) => Promise<void>;
}) {
  return (
    <div className={`site-settings-page is-${view}`}>
      <NoAgentMessageSettingsPanel
        settings={noAgentMessage}
        saving={noAgentSaving}
        onSave={onSaveNoAgentMessage}
      />
    </div>
  );
}

export function SiteLogoQuickUpload({
  onChange,
  onReady,
}: {
  onChange: (siteLogo: SiteLogoInfo | null) => void;
  onReady: (openPicker: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<LogoPhase>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    onReady(() => inputRef.current?.click());
  }, [onReady]);

  const busy = phase !== 'idle';

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    setPhase('processing');
    setError('');
    try {
      const next = await prepareSiteLogo(file);
      setPhase('uploading');
      const result = await uploadSiteLogo(next.blob, () => {
        setPhase('saving');
      });
      onChange(result.siteLogo);
      if (result.cleanupWarning) {
        setError('新 Logo 已生效，但旧图片清理失败，请稍后重试。');
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '上传站点 Logo 失败。',
      );
    } finally {
      setPhase('idle');
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className="site-logo-file-input"
        type="file"
        accept={SITE_LOGO_ACCEPT}
        disabled={busy}
        onChange={(event) => void onFileChange(event)}
      />
      {phase !== 'idle' ? (
        <span className="site-logo-upload-status" role="status">
          {phaseLabel(phase)}
        </span>
      ) : null}
      {error ? (
        <span className="site-logo-upload-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

function phaseLabel(phase: LogoPhase): string {
  if (phase === 'processing') return '正在处理图片…';
  if (phase === 'uploading') return '正在上传 Logo…';
  if (phase === 'saving') return '正在保存站点设置…';
  return '';
}
