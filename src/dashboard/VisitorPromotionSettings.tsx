import { useEffect, useState, type FormEvent } from 'react';
import {
  getVisitorPromotion,
  updateVisitorPromotion,
  type VisitorPromotionSettings,
} from './visitor-promotion-client';
import { Button, Field, Input, Textarea } from './ui';

const EMPTY_PROMOTION: VisitorPromotionSettings = {
  id: null,
  isEnabled: false,
  title: '',
  summary: '',
  coverUrl: null,
  bodyMarkdown: '',
  ctaLabel: null,
  ctaUrl: null,
  startsAt: null,
  endsAt: null,
  createdAt: null,
  updatedAt: null,
};

export function VisitorPromotionSettingsPanel() {
  const [saved, setSaved] = useState<VisitorPromotionSettings | null>(null);
  const [draft, setDraft] = useState<VisitorPromotionSettings>(EMPTY_PROMOTION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    getVisitorPromotion()
      .then((promotion) => {
        const next = promotion ?? EMPTY_PROMOTION;
        setSaved(next);
        setDraft(next);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : '无法加载访客推广');
      })
      .finally(() => setLoading(false));
  }, []);

  const changed = saved
    ? JSON.stringify(saved) !== JSON.stringify(draft)
    : false;
  const canSave =
    changed &&
    Boolean(draft.title.trim()) &&
    Boolean(draft.summary.trim()) &&
    Boolean(draft.bodyMarkdown.trim()) &&
    !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError('');
    setSavedNotice(false);
    try {
      const promotion = await updateVisitorPromotion({
        isEnabled: draft.isEnabled,
        title: draft.title,
        summary: draft.summary,
        coverUrl: normalizeOptional(draft.coverUrl),
        bodyMarkdown: draft.bodyMarkdown,
        ctaLabel: normalizeOptional(draft.ctaLabel),
        ctaUrl: normalizeOptional(draft.ctaUrl),
        startsAt: normalizeOptional(draft.startsAt),
        endsAt: normalizeOptional(draft.endsAt),
      });
      setSaved(promotion);
      setDraft(promotion);
      setSavedNotice(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存访客推广失败');
    } finally {
      setSaving(false);
    }
  }

  function updateDraft(patch: Partial<VisitorPromotionSettings>) {
    setSavedNotice(false);
    setDraft((current) => ({ ...current, ...patch }));
  }

  if (loading) {
    return <div className="empty-state">正在加载访客推广…</div>;
  }

  return (
    <section
      className="no-agent-settings-card"
      aria-labelledby="visitor-promotion-title"
    >
      <header className="no-agent-settings-intro">
        <div>
          <span className="admin-section-kicker">访客端内容</span>
          <h2 id="visitor-promotion-title">Visitor Promotion</h2>
          <p>
            配置 Messages 顶部的置顶文章入口。推广内容独立于客服会话和未读消息。
          </p>
        </div>
        <span className="no-agent-behavior-badge">
          {draft.isEnabled ? '已启用' : '未启用'}
        </span>
      </header>

      <form onSubmit={submit} className="no-agent-settings-form">
        <Field asChild unstyled>
          <label className="no-agent-message-field">
            <span className="no-agent-message-label">
              <strong>Enabled</strong>
            </span>
            <input
              type="checkbox"
              checked={draft.isEnabled}
              disabled={saving}
              onChange={(event) =>
                updateDraft({ isEnabled: event.target.checked })
              }
            />
          </label>
        </Field>

        <PromotionTextField
          label="Title"
          value={draft.title}
          maxLength={160}
          required
          disabled={saving}
          onChange={(title) => updateDraft({ title })}
        />
        <PromotionTextField
          label="Summary"
          value={draft.summary}
          maxLength={320}
          required
          disabled={saving}
          onChange={(summary) => updateDraft({ summary })}
        />
        <PromotionTextField
          label="Cover URL"
          value={draft.coverUrl ?? ''}
          maxLength={2048}
          disabled={saving}
          placeholder="https://example.com/cover.webp"
          onChange={(coverUrl) => updateDraft({ coverUrl })}
        />

        <Field asChild unstyled>
          <label className="no-agent-message-field">
            <span className="no-agent-message-label">
              <strong>Article</strong>
              <small>{draft.bodyMarkdown.length}/100000</small>
            </span>
            <Textarea
              value={draft.bodyMarkdown}
              maxLength={100000}
              rows={12}
              disabled={saving}
              required
              placeholder="# Promotion article"
              onChange={(event) =>
                updateDraft({ bodyMarkdown: event.target.value })
              }
            />
            <small>
              使用 Markdown；Storefront 使用现有安全 Markdown renderer 显示。
            </small>
          </label>
        </Field>

        <PromotionTextField
          label="CTA Label"
          value={draft.ctaLabel ?? ''}
          maxLength={80}
          disabled={saving}
          onChange={(ctaLabel) => updateDraft({ ctaLabel })}
        />
        <PromotionTextField
          label="CTA URL"
          value={draft.ctaUrl ?? ''}
          maxLength={2048}
          disabled={saving}
          placeholder="https://example.com/offer"
          onChange={(ctaUrl) => updateDraft({ ctaUrl })}
        />
        <PromotionTextField
          label="Start"
          type="datetime-local"
          value={toLocalDateTime(draft.startsAt)}
          disabled={saving}
          onChange={(value) => updateDraft({ startsAt: toIsoDateTime(value) })}
        />
        <PromotionTextField
          label="End"
          type="datetime-local"
          value={toLocalDateTime(draft.endsAt)}
          disabled={saving}
          onChange={(value) => updateDraft({ endsAt: toIsoDateTime(value) })}
        />

        {error ? (
          <span className="site-logo-error" role="alert">
            {error}
          </span>
        ) : null}

        <footer className="no-agent-settings-actions">
          <span role="status" aria-live="polite">
            {savedNotice
              ? '已保存'
              : draft.updatedAt
                ? `最近更新：${new Date(draft.updatedAt).toLocaleString()}`
                : '尚未创建推广内容'}
          </span>
          <Button type="submit" disabled={!canSave}>
            {saving ? '保存中…' : changed ? '保存推广' : '当前已保存'}
          </Button>
        </footer>
      </form>
    </section>
  );
}

function PromotionTextField({
  label,
  value,
  type = 'text',
  maxLength,
  required = false,
  disabled,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  type?: string;
  maxLength?: number;
  required?: boolean;
  disabled: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field asChild unstyled>
      <label className="no-agent-message-field">
        <span className="no-agent-message-label">
          <strong>{label}</strong>
          {maxLength ? (
            <small>
              {value.length}/{maxLength}
            </small>
          ) : null}
        </span>
        <Input
          type={type}
          value={value}
          maxLength={maxLength}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </Field>
  );
}

function normalizeOptional(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized || null;
}

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
