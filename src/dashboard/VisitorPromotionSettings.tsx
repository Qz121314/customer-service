import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Field, Input, Textarea } from './ui';
import {
  getVisitorPromotion,
  updateVisitorPromotion,
  type VisitorPromotionDraft,
} from './visitor-promotion-client';
import './visitor-promotion-settings.css';

const EMPTY_PROMOTION: VisitorPromotionDraft = {
  isEnabled: false,
  title: '',
  summary: '',
  coverUrl: null,
  bodyMarkdown: '',
  ctaLabel: null,
  ctaUrl: null,
  startsAt: null,
  endsAt: null,
};

export function VisitorPromotionSettingsPanel() {
  const [draft, setDraft] = useState<VisitorPromotionDraft>(EMPTY_PROMOTION);
  const [loadedDraft, setLoadedDraft] =
    useState<VisitorPromotionDraft>(EMPTY_PROMOTION);
  const [revision, setRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void getVisitorPromotion()
      .then((promotion) => {
        if (!active) return;
        const next = promotion
          ? {
              isEnabled: promotion.isEnabled,
              title: promotion.title,
              summary: promotion.summary,
              coverUrl: promotion.coverUrl,
              bodyMarkdown: promotion.bodyMarkdown,
              ctaLabel: promotion.ctaLabel,
              ctaUrl: promotion.ctaUrl,
              startsAt: promotion.startsAt,
              endsAt: promotion.endsAt,
            }
          : EMPTY_PROMOTION;
        setDraft(next);
        setLoadedDraft(next);
        setRevision(promotion?.revision ?? null);
      })
      .catch(() => {
        if (active) setError('无法加载访客推广配置。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(loadedDraft),
    [draft, loadedDraft],
  );
  const canSave =
    changed &&
    Boolean(draft.title.trim()) &&
    Boolean(draft.summary.trim()) &&
    Boolean(draft.bodyMarkdown.trim()) &&
    !loading &&
    !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const promotion = await updateVisitorPromotion(draft);
      const next = {
        isEnabled: promotion.isEnabled,
        title: promotion.title,
        summary: promotion.summary,
        coverUrl: promotion.coverUrl,
        bodyMarkdown: promotion.bodyMarkdown,
        ctaLabel: promotion.ctaLabel,
        ctaUrl: promotion.ctaUrl,
        startsAt: promotion.startsAt,
        endsAt: promotion.endsAt,
      };
      setDraft(next);
      setLoadedDraft(next);
      setRevision(promotion.revision);
      setSaved(true);
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : '';
      setError(
        code === 'INVALID_PROMOTION_URL'
          ? 'Cover URL 只允许有效的 http/https 地址。'
          : code === 'INVALID_PROMOTION_CTA'
            ? 'CTA Label 与 CTA URL 必须同时填写，且 URL 只允许 http/https。'
            : code === 'INVALID_PROMOTION_TIME'
              ? '开始/结束时间无效，结束时间必须晚于开始时间。'
              : '保存访客推广失败，请检查内容后重试。',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="visitor-promotion-card" aria-labelledby="visitor-promotion-title">
      <header className="visitor-promotion-intro">
        <div>
          <span className="admin-section-kicker">Visitor Messages</span>
          <h2 id="visitor-promotion-title">访客推广</h2>
          <p>配置 Messages 顶部的独立置顶内容。它不是会话，也不会影响聊天未读数。</p>
        </div>
        <span className="visitor-promotion-revision">
          {revision ? `Revision ${revision}` : '未发布'}
        </span>
      </header>

      {loading ? <p role="status">正在加载配置…</p> : null}
      {error ? (
        <p className="visitor-promotion-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading ? (
        <form className="visitor-promotion-form" onSubmit={submit}>
          <label className="visitor-promotion-toggle">
            <input
              type="checkbox"
              checked={draft.isEnabled}
              disabled={saving}
              onChange={(event) => {
                setSaved(false);
                setDraft((current) => ({
                  ...current,
                  isEnabled: event.target.checked,
                }));
              }}
            />
            <span>
              <strong>Enabled</strong>
              <small>只有启用且处于有效时间窗口时才向访客返回。</small>
            </span>
          </label>

          <div className="visitor-promotion-grid">
            <PromotionField label="Title">
              <Input
                value={draft.title}
                maxLength={160}
                disabled={saving}
                required
                onChange={(event) => update('title', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="Summary">
              <Input
                value={draft.summary}
                maxLength={320}
                disabled={saving}
                required
                onChange={(event) => update('summary', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="Cover URL" hint="可选；仅 http/https。">
              <Input
                type="url"
                value={draft.coverUrl ?? ''}
                disabled={saving}
                placeholder="https://…"
                onChange={(event) => updateNullable('coverUrl', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="CTA Label" hint="可选；与 CTA URL 同时填写。">
              <Input
                value={draft.ctaLabel ?? ''}
                maxLength={80}
                disabled={saving}
                onChange={(event) => updateNullable('ctaLabel', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="CTA URL" hint="可选；仅 http/https。">
              <Input
                type="url"
                value={draft.ctaUrl ?? ''}
                disabled={saving}
                placeholder="https://…"
                onChange={(event) => updateNullable('ctaUrl', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="Start" hint="留空表示立即可用。">
              <Input
                type="datetime-local"
                value={toLocalDateTime(draft.startsAt)}
                disabled={saving}
                onChange={(event) => updateTimestamp('startsAt', event.target.value)}
              />
            </PromotionField>
            <PromotionField label="End" hint="留空表示不自动结束。">
              <Input
                type="datetime-local"
                value={toLocalDateTime(draft.endsAt)}
                disabled={saving}
                onChange={(event) => updateTimestamp('endsAt', event.target.value)}
              />
            </PromotionField>
          </div>

          <PromotionField label="Article" hint="Markdown；访客端使用现有安全 Markdown renderer。">
            <Textarea
              value={draft.bodyMarkdown}
              rows={12}
              maxLength={100000}
              disabled={saving}
              required
              onChange={(event) => update('bodyMarkdown', event.target.value)}
            />
          </PromotionField>

          <footer className="visitor-promotion-actions">
            <span role="status" aria-live="polite">
              {saved
                ? '已保存；新 revision 将重新显示 NEW。'
                : changed
                  ? '有未保存修改'
                  : '当前配置已保存'}
            </span>
            <Button type="submit" disabled={!canSave}>
              {saving ? '保存中…' : '保存访客推广'}
            </Button>
          </footer>
        </form>
      ) : null}
    </section>
  );

  function update(key: 'title' | 'summary' | 'bodyMarkdown', value: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateNullable(
    key: 'coverUrl' | 'ctaLabel' | 'ctaUrl',
    value: string,
  ) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value.trim() ? value : null }));
  }

  function updateTimestamp(key: 'startsAt' | 'endsAt', value: string) {
    setSaved(false);
    setDraft((current) => ({
      ...current,
      [key]: value ? new Date(value).toISOString() : null,
    }));
  }
}

function PromotionField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Field asChild unstyled>
      <label className="visitor-promotion-field">
        <strong>{label}</strong>
        {children}
        {hint ? <small>{hint}</small> : null}
      </label>
    </Field>
  );
}

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
