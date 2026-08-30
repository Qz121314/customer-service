import { useEffect, useState, type FormEvent } from "react";
import type { NoAgentMessageFormat, NoAgentMessageSettings } from "./api";
import { Button } from "./ui";

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

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch {
      // The parent displays the request error.
    }
  }

  function selectFormat(format: NoAgentMessageFormat) {
    setDraft((current) => ({ ...current, format }));
  }

  return (
    <section className="no-agent-settings-card">
      <div className="no-agent-settings-intro">
        <span className="admin-section-kicker">访客体验</span>
        <h2>无客服可用时的提示语</h2>
        <p>
          当产品没有符合分流规则的在线客服时，系统不会创建等待会话，而是立即返回这段提示。
        </p>
      </div>

      <form onSubmit={submit} className="no-agent-settings-form">
        <div
          className="no-agent-format-switch"
          role="group"
          aria-label="提示语格式"
        >
          <button
            type="button"
            className={draft.format === "plain" ? "active" : ""}
            aria-pressed={draft.format === "plain"}
            onClick={() => selectFormat("plain")}
          >
            普通文本
          </button>
          <button
            type="button"
            className={draft.format === "markdown" ? "active" : ""}
            aria-pressed={draft.format === "markdown"}
            onClick={() => selectFormat("markdown")}
          >
            Markdown
          </button>
        </div>

        <label className="no-agent-message-field">
          <span>提示语内容</span>
          <textarea
            value={draft.message}
            maxLength={4000}
            rows={12}
            placeholder="例如：当前暂无客服在线，请稍后再试。"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                message: event.target.value,
              }))
            }
            disabled={saving}
            required
          />
          <small>
            {draft.format === "markdown"
              ? "保存 Markdown 原文；访客端按 Markdown 格式安全渲染。"
              : "按普通文本显示，不解析 Markdown。"}
          </small>
        </label>

        <div className="no-agent-settings-actions">
          <Button type="submit" disabled={saving || !draft.message.trim()}>
            {saving ? "保存中…" : "保存提示语"}
          </Button>
          {saved ? <span role="status">已保存</span> : null}
        </div>
      </form>
    </section>
  );
}
