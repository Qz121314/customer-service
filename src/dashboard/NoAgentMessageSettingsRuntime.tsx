import { useEffect, useState, type FormEvent } from 'react';
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
        <h2 id="no-agent-settings-title">无客服提示语</h2>
      </header>

      <form onSubmit={submit} className="no-agent-settings-form">
        <NoAgentMessageFormatToolbar
          format={draft.format}
          onFormatChange={selectFormat}
        />
        <NoAgentMessageEditor
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
      <legend>格式</legend>
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
  message,
  saving,
  onMessageChange,
}: {
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
          placeholder="例如：当前暂无客服在线，请稍后再试。"
          onChange={(event) => onMessageChange(event.target.value)}
          disabled={saving}
          required
        />
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
        {saved ? '已保存' : ''}
      </span>
      <Button type="submit" size="sm" disabled={!canSave}>
        {saving ? '保存中…' : changed ? '保存提示语' : '当前已保存'}
      </Button>
    </footer>
  );
}
