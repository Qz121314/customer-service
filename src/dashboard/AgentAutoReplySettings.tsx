import { useEffect, useMemo, useState } from 'react';
import {
  getAgentAutoReplySettings,
  updateAgentAutoReplySettings,
  type AgentAutoReplySettings,
} from './agent-auto-reply-client';
import {
  agentPresetImageUrl,
  getAgentAttachmentPresets,
  uploadAgentAttachmentImage,
  type AgentAttachmentPreset,
} from './agent-attachments-client';
import { UiIcon } from './icons';
import { Button, Textarea } from './ui';

const EMPTY_SETTINGS: AgentAutoReplySettings = {
  enabled: false,
  text: '',
  attachmentIds: [],
};
const AUTO_GREETING_LIMIT = 1000;
const AUTO_GREETING_ATTACHMENT_LIMIT = 6;

export function AgentAutoReplySettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] =
    useState<AgentAutoReplySettings>(EMPTY_SETTINGS);
  const [saved, setSaved] = useState<AgentAutoReplySettings>(EMPTY_SETTINGS);
  const [presets, setPresets] = useState<AgentAttachmentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([getAgentAutoReplySettings(), getAgentAttachmentPresets()])
      .then(([value, attachmentPresets]) => {
        if (!active) return;
        setSettings(value);
        setSaved(value);
        setPresets(attachmentPresets);
      })
      .catch((reason) => {
        if (!active) return;
        setError(
          reason instanceof Error ? reason.message : '无法加载自动回复设置',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !imageUploading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageUploading, onClose, open, saving]);

  const selectedIds = useMemo(
    () => new Set(settings.attachmentIds),
    [settings.attachmentIds],
  );

  if (!open) return null;

  const normalizedText = settings.text.trim();
  const changed =
    settings.enabled !== saved.enabled ||
    settings.text !== saved.text ||
    settings.attachmentIds.join('\n') !== saved.attachmentIds.join('\n');
  const hasContent = Boolean(
    normalizedText || settings.attachmentIds.length > 0,
  );
  const canSave =
    !loading &&
    !saving &&
    !imageUploading &&
    changed &&
    settings.text.length <= AUTO_GREETING_LIMIT &&
    settings.attachmentIds.length <= AUTO_GREETING_ATTACHMENT_LIMIT &&
    (!settings.enabled || hasContent);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const next = await updateAgentAutoReplySettings({
        enabled: settings.enabled,
        text: normalizedText,
        attachmentIds: settings.attachmentIds,
      });
      setSettings(next);
      setSaved(next);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : '自动回复设置保存失败',
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleAttachment = (presetId: string) => {
    setSettings((current) => {
      const selected = current.attachmentIds.includes(presetId);
      if (
        !selected &&
        current.attachmentIds.length >= AUTO_GREETING_ATTACHMENT_LIMIT
      ) {
        return current;
      }
      return {
        ...current,
        attachmentIds: selected
          ? current.attachmentIds.filter((id) => id !== presetId)
          : [...current.attachmentIds, presetId],
      };
    });
  };

  const uploadGreetingImage = async (file: File) => {
    if (
      imageUploading ||
      settings.attachmentIds.length >= AUTO_GREETING_ATTACHMENT_LIMIT
    )
      return;
    setImageUploading(true);
    setError('');
    try {
      const preset = await uploadAgentAttachmentImage(
        file,
        file.name || '问候图片',
      );
      setPresets((current) => [...current, preset]);
      setSettings((current) => ({
        ...current,
        attachmentIds: [...current.attachmentIds, preset.id],
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '问候图片上传失败');
    } finally {
      setImageUploading(false);
    }
  };

  return (
    <div
      className="agent-auto-reply-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving && !imageUploading)
          onClose();
      }}
    >
      <section
        className="agent-auto-reply-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-auto-reply-title"
      >
        <header className="agent-auto-reply-head">
          <div>
            <span className="eyebrow">自动回复</span>
            <h2 id="agent-auto-reply-title">首次问候语</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="agent-auto-reply-close"
            aria-label="关闭自动回复设置"
            disabled={saving || imageUploading}
            onClick={onClose}
          >
            <UiIcon name="close" />
          </Button>
        </header>

        {loading ? (
          <div className="agent-auto-reply-loading">正在读取设置…</div>
        ) : (
          <div className="agent-auto-reply-body">
            <label className="agent-auto-reply-switch">
              <span>
                <strong>自动发送首次问候</strong>
                <small>客户的新咨询首次真正分配给你时最多发送一次。</small>
              </span>
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
              />
              <i aria-hidden="true" />
            </label>

            <label className="agent-auto-reply-field">
              <span>问候文案</span>
              <Textarea
                value={settings.text}
                maxLength={AUTO_GREETING_LIMIT}
                rows={5}
                placeholder="例如：您好，我来为您服务，请问有什么可以帮您？"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
              />
              <small>
                {settings.text.length}/{AUTO_GREETING_LIMIT}
              </small>
            </label>

            <section className="agent-auto-reply-attachments">
              <div className="agent-auto-reply-attachments-head">
                <span>
                  <strong>附件</strong>
                  <small>
                    可搭配手机号、链接和图片；最多{' '}
                    {AUTO_GREETING_ATTACHMENT_LIMIT} 个。
                  </small>
                </span>
                <label
                  className={`agent-auto-reply-image-picker${imageUploading ? ' is-busy' : ''}`}
                >
                  <UiIcon name="image-plus" />
                  <span>{imageUploading ? '上传中…' : '添加图片'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={
                      imageUploading ||
                      settings.attachmentIds.length >=
                        AUTO_GREETING_ATTACHMENT_LIMIT
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void uploadGreetingImage(file);
                    }}
                  />
                </label>
              </div>

              <div className="agent-auto-reply-attachment-grid">
                {presets.map((preset) => {
                  const selected = selectedIds.has(preset.id);
                  return (
                    <button
                      type="button"
                      className={`agent-auto-reply-attachment${selected ? ' is-selected' : ''}`}
                      aria-pressed={selected}
                      key={preset.id}
                      onClick={() => toggleAttachment(preset.id)}
                    >
                      {preset.kind === 'image' ? (
                        <img
                          src={agentPresetImageUrl(preset.id)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <i aria-hidden="true">
                          <UiIcon
                            name={preset.kind === 'phone' ? 'phone' : 'link'}
                          />
                        </i>
                      )}
                      <span>
                        <strong>{preset.label}</strong>
                        <small>
                          {preset.kind === 'image'
                            ? preset.originalName || '图片'
                            : preset.value}
                        </small>
                      </span>
                      {selected ? <UiIcon name="check" /> : null}
                    </button>
                  );
                })}
                {presets.length === 0 ? (
                  <p className="agent-auto-reply-attachment-empty">
                    还没有附件。可先添加问候图片；手机号和链接可在聊天输入框的“+”中预设。
                  </p>
                ) : null}
              </div>
            </section>

            <div className="agent-auto-reply-note">
              问候语支持纯文案、纯附件或文案 +
              附件。发送后会保存当时的附件快照，后续修改预设不会改变历史消息。系统恢复分配和重连也不会重复发送。
            </div>
            {settings.enabled && !hasContent ? (
              <div className="auth-error">开启后至少需要文案或一个附件。</div>
            ) : null}
            {error ? <div className="auth-error">{error}</div> : null}
          </div>
        )}

        <footer className="agent-auto-reply-actions">
          <Button
            type="button"
            variant="ghost"
            disabled={saving || imageUploading}
            onClick={onClose}
          >
            关闭
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()}>
            {saving ? '保存中…' : changed ? '保存设置' : '已保存'}
          </Button>
        </footer>
      </section>
    </div>
  );
}
