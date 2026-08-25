import { useEffect, useState } from 'react';
import {
  getAgentAutoReplySettings,
  updateAgentAutoReplySettings,
  type AgentAutoReplySettings,
} from './agent-auto-reply-client';
import { UiIcon } from './icons';

const EMPTY_SETTINGS: AgentAutoReplySettings = {
  enabled: false,
  text: '',
};
const AUTO_GREETING_LIMIT = 1000;

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void getAgentAutoReplySettings()
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setSaved(value);
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
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open, saving]);

  if (!open) return null;

  const normalizedText = settings.text.trim();
  const changed =
    settings.enabled !== saved.enabled || settings.text !== saved.text;
  const canSave =
    !loading &&
    !saving &&
    changed &&
    settings.text.length <= AUTO_GREETING_LIMIT &&
    (!settings.enabled || Boolean(normalizedText));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const next = await updateAgentAutoReplySettings({
        enabled: settings.enabled,
        text: normalizedText,
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

  return (
    <div
      className="agent-auto-reply-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
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
          <button
            type="button"
            className="agent-auto-reply-close"
            aria-label="关闭自动回复设置"
            disabled={saving}
            onClick={onClose}
          >
            <UiIcon name="close" />
          </button>
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
              <span>问候内容</span>
              <textarea
                value={settings.text}
                maxLength={AUTO_GREETING_LIMIT}
                rows={6}
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

            <div className="agent-auto-reply-note">
              未开启或未配置问候语时，会话仍会正常创建和分配，不会发送任何默认文案。转接、重新排队和重连也不会重复发送。
            </div>
            {error ? <div className="auth-error">{error}</div> : null}
          </div>
        )}

        <footer className="agent-auto-reply-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={saving}
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!canSave}
            onClick={() => void save()}
          >
            {saving ? '保存中…' : changed ? '保存设置' : '已保存'}
          </button>
        </footer>
      </section>
    </div>
  );
}
