import { useEffect, useRef, useState } from 'react';
import {
  deleteAgentAvatar,
  getAgentAvatarProfile,
  uploadAgentAvatar,
} from './agent-avatar-client';
import {
  prepareAgentAvatar,
  type PreparedAgentAvatar,
} from './agent-avatar-image';

export function AgentAvatarControl({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [prepared, setPrepared] = useState<PreparedAgentAvatar | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    void getAgentAvatarProfile()
      .then((profile) => {
        if (active) setAvatarUrl(profile.avatarUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [agentId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !processing) closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving, processing]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const initials = agentName.trim().slice(0, 1).toUpperCase() || 'CS';
  const displayUrl = previewUrl ?? avatarUrl;

  function clearPrepared() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPrepared(null);
    setError('');
  }

  function closeDialog() {
    if (saving || processing) return;
    clearPrepared();
    setOpen(false);
  }

  async function selectFile(file: File) {
    setError('');
    setProcessing(true);
    try {
      const next = await prepareAgentAvatar(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPrepared(next);
      setPreviewUrl(URL.createObjectURL(next.blob));
    } catch (reason) {
      setPrepared(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setError(reason instanceof Error ? reason.message : '头像处理失败');
    } finally {
      setProcessing(false);
    }
  }

  async function confirmAvatar() {
    if (!prepared || saving) return;
    setSaving(true);
    setError('');
    try {
      const profile = await uploadAgentAvatar(prepared.blob, prepared.mimeType);
      setAvatarUrl(profile.avatarUrl);
      clearPrepared();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '头像上传失败');
    } finally {
      setSaving(false);
    }
  }

  async function removeAvatar() {
    if (!avatarUrl || saving) return;
    setSaving(true);
    setError('');
    try {
      const profile = await deleteAgentAvatar();
      setAvatarUrl(profile.avatarUrl);
      clearPrepared();
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '头像删除失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="agent-avatar-button"
        aria-label="更换客服头像"
        title="更换客服头像"
        onClick={() => setOpen(true)}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{initials}</span>}
        <i aria-hidden="true" />
      </button>

      {open ? (
        <div
          className="agent-avatar-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="agent-avatar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-avatar-title"
          >
            <header>
              <div>
                <h2 id="agent-avatar-title">客服头像</h2>
                <p>图片只在本机压缩和预览，确认后才上传。</p>
              </div>
              <button
                type="button"
                className="agent-avatar-close"
                aria-label="关闭"
                disabled={saving || processing}
                onClick={closeDialog}
              >
                ×
              </button>
            </header>

            <div className="agent-avatar-preview-stage">
              <div className="agent-avatar-preview">
                {displayUrl ? (
                  <img src={displayUrl} alt="头像预览" />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              {processing ? <small>正在本地处理图片…</small> : null}
              {prepared && !processing ? (
                <small>
                  {prepared.width} × {prepared.height} · {formatBytes(prepared.byteSize)}
                </small>
              ) : null}
            </div>

            {error ? (
              <p className="agent-avatar-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="agent-avatar-picker-row">
              <button
                type="button"
                className="agent-avatar-select"
                disabled={saving || processing}
                onClick={() => inputRef.current?.click()}
              >
                {prepared || avatarUrl ? '更换照片' : '选择照片'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void selectFile(file);
                }}
              />
            </div>

            <footer>
              {avatarUrl && !prepared ? (
                <button
                  type="button"
                  className="agent-avatar-remove"
                  disabled={saving || processing}
                  onClick={() => void removeAvatar()}
                >
                  删除头像
                </button>
              ) : (
                <button
                  type="button"
                  className="agent-avatar-cancel"
                  disabled={saving || processing}
                  onClick={closeDialog}
                >
                  取消
                </button>
              )}
              <button
                type="button"
                className="agent-avatar-confirm"
                disabled={!prepared || saving || processing}
                onClick={() => void confirmAvatar()}
              >
                {saving ? '上传中…' : '确认使用'}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
