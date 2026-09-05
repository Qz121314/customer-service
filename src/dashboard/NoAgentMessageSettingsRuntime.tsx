import { useEffect, useId, useState, type FormEvent } from 'react';
import type { NoAgentMessageFormat, NoAgentMessageSettings } from './api';
import { Button, Field, Textarea } from './ui';

export function NoAgentMessageSettingsPanel({
  settings,
  saving,
  onSave,
}: {
  settings: NoAgentMessageSettings;
  saving: boolean;
  onSave: (settings: NoAgentMessageSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const helperId = useId();
  const changed =
    draft.message !== settings.message || draft.format !== settings.format;
  const canSave = changed && Boolean(draft.message.trim()) && !saving;

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch {
      // The parent displays the request error.
    }
  }

  function selectFormat(format: NoAgentMessageFormat) {
    setSaved(false);
    setDraft((current) => ({ ...current, format }));
  }

  function updateMessage(message: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, message }));
  }

  return (
    <section
      className="no-agent-settings-card"
      aria-labelledby="no-agent-settings-title"
    >
      <header className="no-agent-settings-intro">
        <div>
          <span className="admin-section-kicker">访客端响应</span>
          <h2 id="no-agent-settings-title">无客服提示语</h2>
          <p>
            没有符合分流规则的在线客服时，访客会立即看到这段内容，系统不会创建等待会话。
          </p>
        </div>
        <span className="no-agent-behavior-badge">即时返回</span>
      </header>

      <form onSubmit={submit} className="no-agent-settings-form">
        <NoAgentMessageFormatToolbar
          format={draft.format}
          onFormatChange={selectFormat}
        />
        <NoAgentMessageEditor
          format={draft.format}
          helperId={helperId}
          message={draft.message}
          saving={saving}
          onMessageChange={updateMessage}
        />
        <NoAgentMessageActions
          canSave={canSave}
          changed={changed}
          saved={saved}
          saving={saving}
        />
      </form>
    </section>
  );
}

function NoAgentMessageFormatToolbar({
  format,
  onFormatChange,
}: {
  format: NoAgentMessageFormat;
  onFormatChange: (format: NoAgentMessageFormat) => void;
}) {
  return (
    <fieldset className="no-agent-format-field">
      <legend>内容格式</legend>
      <div
        className="no-agent-format-switch"
        role="group"
        aria-label="提示语格式"
      >
        <Button
          unstyled
          type="button"
          className={format === 'plain' ? 'active' : ''}
          aria-pressed={format === 'plain'}
          onClick={() => onFormatChange('plain')}
        >
          普通文本
        </Button>
        <Button
          unstyled
          type="button"
          className={format === 'markdown' ? 'active' : ''}
          aria-pressed={format === 'markdown'}
          onClick={() => onFormatChange('markdown')}
        >
          Markdown
        </Button>
      </div>
    </fieldset>
  );
}

function NoAgentMessageEditor({
  format,
  helperId,
  message,
  saving,
  onMessageChange,
}: {
  format: NoAgentMessageFormat;
  helperId: string;
  message: string;
  saving: boolean;
  onMessageChange: (message: string) => void;
}) {
  return (
    <Field asChild unstyled>
      <label className="no-agent-message-field">
        <span className="no-agent-message-label">
          <strong>提示内容</strong>
          <small>{message.length}/4000</small>
        </span>
        <Textarea
          value={message}
          maxLength={4000}
          rows={6}
          aria-describedby={helperId}
          placeholder="例如：当前暂无客服在线，请稍后再试。"
          onChange={(event) => onMessageChange(event.target.value)}
          disabled={saving}
          required
        />
        <small id={helperId}>
          {format === 'markdown'
            ? '支持标题、加粗、列表和链接；访客端会安全解析并居中展示。'
            : '按普通文本显示，访客端会居中展示。'}
        </small>
      </label>
    </Field>
  );
}

function NoAgentMessageActions({
  canSave,
  changed,
  saved,
  saving,
}: {
  canSave: boolean;
  changed: boolean;
  saved: boolean;
  saving: boolean;
}) {
  return (
    <footer className="no-agent-settings-actions">
      <span role="status" aria-live="polite">
        {saved ? '已保存并生效' : '保存后立即用于新的咨询请求'}
      </span>
      <Button type="submit" disabled={!canSave}>
        {saving ? '保存中…' : changed ? '保存提示语' : '当前已保存'}
      </Button>
    </footer>
  );
}
