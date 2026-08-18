import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './dashboard-ui';
import {
  loadAgentInitialGreeting,
  saveAgentInitialGreeting,
} from './agent-auto-reply-client';
import './agent-auto-reply.css';

const MAX_GREETING_LENGTH = 2000;

export function AgentAutoReplyControl() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void loadAgentInitialGreeting()
      .then((value) => {
        if (!active) return;
        setEnabled(value.enabled);
        setText(value.text);
      })
      .catch(() => {
        if (active) setError('自动回复设置加载失败');
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
      if (event.key === 'Escape' && !saving) setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving]);

  const trimmed = text.trim();
  const invalidEnabledGreeting = enabled && !trimmed;

  async function save() {
    if (saving || invalidEnabledGreeting) return;
    setSaving(true);
    setError('');
    try {
      const value = await saveAgentInitialGreeting({ enabled, text });
      setEnabled(value.enabled);
      setText(value.text);
      setOpen(false);
    } catch {
      setError('自动回复设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ghost-button full workspace-auto-reply-button"
        aria-label="自动回复"
        title="自动回复"
        onClick={() => setOpen(true)}
      >
        <UiIcon name="workspace" />
        <span>自动回复</span>
      </button>
      {open
        ? createPortal(
            <div
              className="agent-auto-reply-overlay"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget && !saving) {
                  setOpen(false);
                }
              }}
            >
              <section
                className="agent-auto-reply-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-auto-reply-title"
              >
                <header className="agent-auto-reply-header">
                  <div>
                    <span className="agent-auto-reply-kicker">自动回复</span>
                    <h2 id="agent-auto-reply-title">首次问候语</h2>
                  </div>
                  <button
                    type="button"
                    className="agent-auto-reply-close"
                    aria-label="关闭"
                    disabled={saving}
                    onClick={() => setOpen(false)}
                  >
                    ×
                  </button>
                </header>

                {loading ? (
                  <div className="agent-auto-reply-loading">正在加载…</div>
                ) : (
                  <div className="agent-auto-reply-body">
                    <label className="agent-auto-reply-switch-row">
                      <span>
                        <strong>自动问候</strong>
                        <small>新咨询首次分配给你时最多发送一次</small>
                      </span>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => setEnabled(event.target.checked)}
                      />
                    </label>

                    <label className="agent-auto-reply-editor">
                      <span>问候内容</span>
                      <textarea
                        value={text}
                        maxLength={MAX_GREETING_LENGTH}
                        rows={5}
                        placeholder="输入你的首次问候语"
                        onChange={(event) => setText(event.target.value)}
                      />
                      <span className="agent-auto-reply-count">
                        {text.length}/{MAX_GREETING_LENGTH}
                      </span>
                    </label>

                    <p className="agent-auto-reply-note">
                      未开启或未填写内容时不会发送任何自动消息，会话仍会正常建立。
                    </p>
                    {invalidEnabledGreeting ? (
                      <p className="agent-auto-reply-error">
                        开启自动问候前需要填写内容。
                      </p>
                    ) : null}
                    {error ? (
                      <p className="agent-auto-reply-error">{error}</p>
                    ) : null}
                  </div>
                )}

                <footer className="agent-auto-reply-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={saving}
                    onClick={() => setOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={loading || saving || invalidEnabledGreeting}
                    onClick={() => void save()}
                  >
                    {saving ? '正在保存…' : '保存'}
                  </button>
                </footer>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
