import { useEffect, useMemo, useState } from 'react';
import {
  getAgentFirstReplySettings,
  updateAgentFirstReplySettings,
  type AgentFirstReplyProfile,
  type AgentFirstReplySettings,
} from './agent-auto-reply-client';
import {
  agentPresetImageUrl,
  deleteAgentAttachmentPreset,
  getAgentAttachmentPresets,
  uploadAgentAttachmentImage,
  type AgentAttachmentPreset,
  type AgentContactCardKind,
} from './agent-attachments-client';
import { AgentContactCardIcon } from './AgentContactCardIcon';
import { UiIcon } from './icons';
import { Button, Input, Textarea } from './ui';

const EMPTY_PROFILE: AgentFirstReplyProfile = {
  id: 'new-first-reply',
  name: '默认首次回复',
  greetingId: null,
  attachmentIds: [],
  ctaIds: [],
};
const EMPTY_SETTINGS: AgentFirstReplySettings = {
  enabled: false,
  activeProfileId: null,
  greetings: [],
  ctas: [],
  profiles: [EMPTY_PROFILE],
};
const ATTACHMENT_LIMIT = 6;
const CTA_LIMIT = 10;
const PROFILE_LIMIT = 20;
const CONTACT_CARD_LABELS: Record<AgentContactCardKind, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: '网站',
};

export function AgentAutoReplySettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [saved, setSaved] = useState(EMPTY_SETTINGS);
  const [presets, setPresets] = useState<AgentAttachmentPreset[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null,
  );
  const [quickGreetingText, setQuickGreetingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    setQuickGreetingText('');
    void Promise.all([
      getAgentFirstReplySettings(),
      getAgentAttachmentPresets(),
    ])
      .then(([value, attachmentPresets]) => {
        if (!active) return;
        setSettings(value);
        setSaved(value);
        setPresets(attachmentPresets);
        setSelectedProfileId(
          value.activeProfileId ?? value.profiles[0]?.id ?? null,
        );
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '无法加载首次回复',
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

  const selectedProfile =
    settings.profiles.find((profile) => profile.id === selectedProfileId) ??
    settings.profiles[0] ??
    null;
  const changed =
    JSON.stringify(settings) !== JSON.stringify(saved) ||
    Boolean(quickGreetingText.trim());
  const activeContent = Boolean(
    selectedProfile?.greetingId || selectedProfile?.attachmentIds.length,
  );
  const canSave =
    !loading &&
    !saving &&
    changed &&
    settings.profiles.length > 0 &&
    settings.profiles.every((profile) => profile.name.trim()) &&
    (!settings.enabled || activeContent || Boolean(quickGreetingText.trim()));

  if (!open) return null;

  const updateSelectedProfile = (
    update: (profile: AgentFirstReplyProfile) => AgentFirstReplyProfile,
  ) => {
    if (!selectedProfile) return;
    setSettings((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === selectedProfile.id ? update(profile) : profile,
      ),
    }));
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const nextGreetings =
        settings.greetings.length === 0 && quickGreetingText.trim()
          ? [
              {
                id: crypto.randomUUID(),
                name: '默认问候语',
                text: quickGreetingText.trim(),
              },
            ]
          : settings.greetings;
      const nextProfile =
        settings.greetings.length === 0 &&
        quickGreetingText.trim() &&
        selectedProfile
          ? { ...selectedProfile, greetingId: nextGreetings[0].id }
          : selectedProfile;
      const next = await updateAgentFirstReplySettings({
        ...settings,
        greetings: nextGreetings,
        activeProfileId: selectedProfile?.id ?? null,
        ctas: settings.ctas.map((item) => ({
          ...item,
          label: item.label.trim(),
          answer: item.answer.trim(),
        })),
        profiles: (nextProfile
          ? settings.profiles.map((profile) =>
              profile.id === nextProfile.id ? nextProfile : profile,
            )
          : settings.profiles
        ).map((profile) => ({ ...profile, name: profile.name.trim() })),
      });
      setSettings(next);
      setSaved(next);
      setQuickGreetingText('');
      setSelectedProfileId(
        next.activeProfileId ?? next.profiles[0]?.id ?? null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '首次回复保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addProfile = () => {
    if (settings.profiles.length >= PROFILE_LIMIT) return;
    const profile: AgentFirstReplyProfile = {
      id: crypto.randomUUID(),
      name: `首次回复方案 ${settings.profiles.length + 1}`,
      greetingId: null,
      attachmentIds: [],
      ctaIds: [],
    };
    setSettings((current) => ({
      ...current,
      profiles: [...current.profiles, profile],
    }));
    setSelectedProfileId(profile.id);
  };

  const removeProfile = () => {
    if (!selectedProfile || settings.profiles.length <= 1) return;
    const profiles = settings.profiles.filter(
      (profile) => profile.id !== selectedProfile.id,
    );
    setSettings((current) => ({ ...current, profiles }));
    setSelectedProfileId(profiles[0]?.id ?? null);
  };

  const toggleAttachment = (presetId: string) => {
    updateSelectedProfile((profile) => {
      const selected = profile.attachmentIds.includes(presetId);
      if (!selected && profile.attachmentIds.length >= ATTACHMENT_LIMIT)
        return profile;
      return {
        ...profile,
        attachmentIds: selected
          ? profile.attachmentIds.filter((id) => id !== presetId)
          : [...profile.attachmentIds, presetId],
      };
    });
  };

  const toggleCta = (ctaId: string) => {
    updateSelectedProfile((profile) => {
      const selected = profile.ctaIds.includes(ctaId);
      if (!selected && profile.ctaIds.length >= CTA_LIMIT) return profile;
      return {
        ...profile,
        ctaIds: selected
          ? profile.ctaIds.filter((id) => id !== ctaId)
          : [...profile.ctaIds, ctaId],
      };
    });
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
        className="agent-auto-reply-dialog agent-first-reply-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="问候语"
      >
        <header className="agent-auto-reply-head">
          <div>
            <span className="eyebrow">客服自动化</span>
            <h2>首次回复</h2>
          </div>
          <div className="agent-auto-reply-head-tools">
            <label className="agent-auto-reply-switch">
              <span>自动发送首次回复</span>
              <input
                type="checkbox"
                aria-label="自动发送问候语"
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
            <Button
              type="button"
              disabled={!canSave}
              onClick={() => void save()}
            >
              {saving ? '保存中…' : changed ? '保存设置' : '已保存'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="agent-auto-reply-close"
              aria-label="关闭自动回复设置"
              disabled={saving}
              onClick={onClose}
            >
              <UiIcon name="close" />
            </Button>
          </div>
        </header>
        {loading ? (
          <div className="agent-auto-reply-loading">正在读取设置…</div>
        ) : (
          <div className="agent-first-reply-body">
            <aside className="agent-first-reply-profiles">
              <div className="agent-first-reply-section-head">
                <span>
                  <strong>配置选择</strong>
                  <small>保存多套组合，启用其中一套</small>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="添加首次回复方案"
                  disabled={settings.profiles.length >= PROFILE_LIMIT}
                  onClick={addProfile}
                >
                  <UiIcon name="plus" />
                </Button>
              </div>
              <div className="agent-first-reply-profile-list">
                {settings.profiles.map((profile) => (
                  <button
                    type="button"
                    key={profile.id}
                    className={
                      profile.id === selectedProfile?.id ? 'is-selected' : ''
                    }
                    onClick={() => setSelectedProfileId(profile.id)}
                  >
                    <span>
                      <strong>{profile.name}</strong>
                      <small>
                        {profile.greetingId ? '问候语' : '无问候语'} ·{' '}
                        {profile.attachmentIds.length} 个附件 ·{' '}
                        {profile.ctaIds.length} 个 CTA
                      </small>
                    </span>
                    {settings.enabled && profile.id === selectedProfile?.id ? (
                      <UiIcon name="check" />
                    ) : null}
                  </button>
                ))}
              </div>
            </aside>
            {selectedProfile ? (
              <main className="agent-first-reply-editor">
                <div className="agent-first-reply-editor-head">
                  <label>
                    <span>方案名称</span>
                    <Input
                      value={selectedProfile.name}
                      maxLength={80}
                      aria-label="首次回复方案名称"
                      onChange={(event) =>
                        updateSelectedProfile((profile) => ({
                          ...profile,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={settings.profiles.length <= 1}
                    onClick={removeProfile}
                  >
                    删除方案
                  </Button>
                </div>
                <section className="agent-first-reply-choice">
                  <SectionHead title="问候语" detail="可选，首次回复前置文案" />
                  <div className="agent-first-reply-choice-list">
                    <button
                      type="button"
                      className={
                        !selectedProfile.greetingId ? 'is-selected' : ''
                      }
                      onClick={() =>
                        updateSelectedProfile((profile) => ({
                          ...profile,
                          greetingId: null,
                        }))
                      }
                    >
                      不使用问候语
                    </button>
                    {settings.greetings.map((greeting) => (
                      <button
                        type="button"
                        className={
                          selectedProfile.greetingId === greeting.id
                            ? 'is-selected'
                            : ''
                        }
                        key={greeting.id}
                        onClick={() =>
                          updateSelectedProfile((profile) => ({
                            ...profile,
                            greetingId: greeting.id,
                          }))
                        }
                      >
                        <strong>{greeting.name}</strong>
                        <small>{greeting.text}</small>
                      </button>
                    ))}
                    {settings.greetings.length === 0 ? (
                      <>
                        <p>素材库还没有问候语。</p>
                        <label className="agent-first-reply-quick-entry">
                          <span>快速录入问候文案</span>
                          <Textarea
                            aria-label="问候文案"
                            value={quickGreetingText}
                            rows={3}
                            maxLength={1000}
                            placeholder="也可以先在这里录入，保存后会自动加入素材库"
                            onChange={(event) =>
                              setQuickGreetingText(event.target.value)
                            }
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                </section>
                <section className="agent-first-reply-choice">
                  <SectionHead
                    title="附件"
                    detail={`可选，名片和图片最多 ${ATTACHMENT_LIMIT} 个`}
                  />
                  <div className="agent-first-reply-attachment-grid">
                    {presets.map((preset) => {
                      const selected = selectedProfile.attachmentIds.includes(
                        preset.id,
                      );
                      return (
                        <button
                          type="button"
                          className={selected ? 'is-selected' : ''}
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
                            <AgentContactCardIcon
                              id={preset.id}
                              kind={preset.kind}
                              source="preset"
                              hasCustomIcon={preset.hasCustomIcon}
                            />
                          )}
                          <span>
                            <strong>{preset.label}</strong>
                            <small>
                              {preset.kind === 'image'
                                ? preset.originalName || '图片'
                                : `${CONTACT_CARD_LABELS[preset.kind]} · ${preset.value}`}
                            </small>
                          </span>
                          {selected ? <UiIcon name="check" /> : null}
                        </button>
                      );
                    })}
                    {presets.length === 0 ? (
                      <p>素材库还没有名片或图片。</p>
                    ) : null}
                  </div>
                </section>
                <section className="agent-first-reply-choice">
                  <SectionHead title="CTA" detail="可选，显示在首次回复下方" />
                  <div className="agent-first-reply-choice-list is-compact">
                    <button
                      type="button"
                      className={
                        selectedProfile.ctaIds.length === 0 ? 'is-selected' : ''
                      }
                      onClick={() =>
                        updateSelectedProfile((profile) => ({
                          ...profile,
                          ctaIds: [],
                        }))
                      }
                    >
                      不使用 CTA
                    </button>
                    {settings.ctas.map((cta) => (
                      <button
                        type="button"
                        className={
                          selectedProfile.ctaIds.includes(cta.id)
                            ? 'is-selected'
                            : ''
                        }
                        key={cta.id}
                        onClick={() => toggleCta(cta.id)}
                      >
                        <strong>{cta.label}</strong>
                        <small>{cta.answer}</small>
                      </button>
                    ))}
                    {settings.ctas.length === 0 ? (
                      <p>素材库还没有 CTA。</p>
                    ) : null}
                  </div>
                </section>
                {settings.enabled &&
                !activeContent &&
                !quickGreetingText.trim() ? (
                  <div className="auth-error">
                    开启后至少选择一个问候语或附件。
                  </div>
                ) : null}
                {error ? <div className="auth-error">{error}</div> : null}
              </main>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function SectionHead({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="agent-first-reply-section-head">
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
    </div>
  );
}

type MaterialTab = 'greetings' | 'ctas' | 'attachments';

export function AgentMaterialsModal({
  open,
  onClose,
  onOpenCardSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenCardSettings: () => void;
}) {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [saved, setSaved] = useState(EMPTY_SETTINGS);
  const [presets, setPresets] = useState<AgentAttachmentPreset[]>([]);
  const [tab, setTab] = useState<MaterialTab>('greetings');
  const [greetingId, setGreetingId] = useState<string | null>(null);
  const [greetingName, setGreetingName] = useState('');
  const [greetingText, setGreetingText] = useState('');
  const [ctaId, setCtaId] = useState<string | null>(null);
  const [ctaLabel, setCtaLabel] = useState('');
  const [ctaAnswer, setCtaAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([
      getAgentFirstReplySettings(),
      getAgentAttachmentPresets(),
    ])
      .then(([value, attachmentPresets]) => {
        if (!active) return;
        setSettings(value);
        setSaved(value);
        setPresets(attachmentPresets);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : '无法加载素材库');
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
    setTab('greetings');
    setGreetingId(null);
    setGreetingName('');
    setGreetingText('');
    setCtaId(null);
    setCtaLabel('');
    setCtaAnswer('');
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving && !imageUploading) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [imageUploading, onClose, open, saving]);

  const changed = JSON.stringify(settings) !== JSON.stringify(saved);
  const editingGreeting = useMemo(
    () => settings.greetings.find((item) => item.id === greetingId) ?? null,
    [greetingId, settings.greetings],
  );
  const editingCta = useMemo(
    () => settings.ctas.find((item) => item.id === ctaId) ?? null,
    [ctaId, settings.ctas],
  );

  useEffect(() => {
    if (editingGreeting) {
      setGreetingName(editingGreeting.name);
      setGreetingText(editingGreeting.text);
    }
  }, [editingGreeting]);
  useEffect(() => {
    if (editingCta) {
      setCtaLabel(editingCta.label);
      setCtaAnswer(editingCta.answer);
    }
  }, [editingCta]);

  if (!open) return null;

  const saveMaterials = async (next: AgentFirstReplySettings = settings) => {
    setSaving(true);
    setError('');
    try {
      const value = await updateAgentFirstReplySettings(next);
      setSettings(value);
      setSaved(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '素材保存失败');
    } finally {
      setSaving(false);
    }
  };
  const saveGreeting = () => {
    const name = greetingName.trim();
    const text = greetingText.trim();
    if (!name || !text) return;
    const id = greetingId ?? crypto.randomUUID();
    const greetings = greetingId
      ? settings.greetings.map((item) =>
          item.id === id ? { id, name, text } : item,
        )
      : [...settings.greetings, { id, name, text }];
    setGreetingId(id);
    void saveMaterials({ ...settings, greetings });
  };
  const removeGreeting = (id: string) => {
    const greetings = settings.greetings.filter((item) => item.id !== id);
    const profiles = settings.profiles.map((profile) =>
      profile.greetingId === id ? { ...profile, greetingId: null } : profile,
    );
    void saveMaterials({ ...settings, greetings, profiles });
    if (greetingId === id) {
      setGreetingId(null);
      setGreetingName('');
      setGreetingText('');
    }
  };
  const saveCta = () => {
    const label = ctaLabel.trim();
    const answer = ctaAnswer.trim();
    if (!label || !answer || (settings.ctas.length >= CTA_LIMIT && !ctaId))
      return;
    const id = ctaId ?? crypto.randomUUID();
    const ctas = ctaId
      ? settings.ctas.map((item) =>
          item.id === id ? { id, label, answer, enabled: item.enabled } : item,
        )
      : [...settings.ctas, { id, label, answer, enabled: true }];
    setCtaId(id);
    void saveMaterials({ ...settings, ctas });
  };
  const removeCta = (id: string) => {
    const ctas = settings.ctas.filter((item) => item.id !== id);
    const profiles = settings.profiles.map((profile) => ({
      ...profile,
      ctaIds: profile.ctaIds.filter((ctaId) => ctaId !== id),
    }));
    void saveMaterials({ ...settings, ctas, profiles });
    if (ctaId === id) {
      setCtaId(null);
      setCtaLabel('');
      setCtaAnswer('');
    }
  };
  const uploadImage = async (file: File) => {
    setImageUploading(true);
    setError('');
    try {
      const preset = await uploadAgentAttachmentImage(
        file,
        file.name || '素材图片',
      );
      setPresets((current) => [...current, preset]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片上传失败');
    } finally {
      setImageUploading(false);
    }
  };
  const removeImage = async (preset: AgentAttachmentPreset) => {
    if (preset.kind !== 'image' || saving) return;
    setSaving(true);
    setError('');
    try {
      await deleteAgentAttachmentPreset(preset.id);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
      setSettings((current) => ({
        ...current,
        profiles: current.profiles.map((profile) => ({
          ...profile,
          attachmentIds: profile.attachmentIds.filter((id) => id !== preset.id),
        })),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片删除失败');
    } finally {
      setSaving(false);
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
        className="agent-auto-reply-dialog agent-materials-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="素材库"
      >
        <header className="agent-auto-reply-head">
          <div>
            <span className="eyebrow">客服自动化</span>
            <h2>素材库</h2>
          </div>
          <div className="agent-auto-reply-head-tools">
            {changed ? (
              <Button
                type="button"
                disabled={saving}
                onClick={() => void saveMaterials()}
              >
                {saving ? '保存中…' : '保存设置'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="关闭素材库"
              disabled={saving || imageUploading}
              onClick={onClose}
            >
              <UiIcon name="close" />
            </Button>
          </div>
        </header>
        {loading ? (
          <div className="agent-auto-reply-loading">正在读取素材…</div>
        ) : (
          <div className="agent-materials-body">
            <nav className="agent-materials-tabs" aria-label="素材类型">
              <button
                type="button"
                className={tab === 'greetings' ? 'is-active' : ''}
                onClick={() => setTab('greetings')}
              >
                问候语 <small>{settings.greetings.length}</small>
              </button>
              <button
                type="button"
                className={tab === 'ctas' ? 'is-active' : ''}
                onClick={() => setTab('ctas')}
              >
                CTA <small>{settings.ctas.length}</small>
              </button>
              <button
                type="button"
                className={tab === 'attachments' ? 'is-active' : ''}
                onClick={() => setTab('attachments')}
              >
                名片与图片 <small>{presets.length}</small>
              </button>
            </nav>
            {tab === 'greetings' ? (
              <MaterialEditorList
                items={settings.greetings}
                selectedId={greetingId}
                onSelect={setGreetingId}
                empty="还没有问候语素材。"
              >
                <div className="agent-material-editor">
                  <SectionHead
                    title={greetingId ? '编辑问候语' : '录入问候语'}
                    detail="保存后可在首次回复方案中重复使用"
                  />
                  {greetingId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeGreeting(greetingId)}
                    >
                      删除
                    </Button>
                  ) : null}
                  <label>
                    <span>名称</span>
                    <Input
                      value={greetingName}
                      maxLength={80}
                      placeholder="例如：英文欢迎语"
                      onChange={(event) => setGreetingName(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>文案</span>
                    <Textarea
                      value={greetingText}
                      maxLength={1000}
                      rows={5}
                      placeholder="例如：您好，我来为您服务。"
                      onChange={(event) => setGreetingText(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={
                      saving || !greetingName.trim() || !greetingText.trim()
                    }
                    onClick={saveGreeting}
                  >
                    {saving ? '保存中…' : '保存问候语'}
                  </Button>
                </div>
              </MaterialEditorList>
            ) : null}
            {tab === 'ctas' ? (
              <MaterialEditorList
                items={settings.ctas.map((item) => ({
                  id: item.id,
                  name: item.label,
                  text: item.answer,
                }))}
                selectedId={ctaId}
                onSelect={setCtaId}
                empty="还没有 CTA 素材。"
              >
                <div className="agent-material-editor">
                  <SectionHead
                    title={ctaId ? '编辑 CTA' : '录入 CTA'}
                    detail="按钮文案和客户点击后的自动回复"
                  />
                  {ctaId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeCta(ctaId)}
                    >
                      删除
                    </Button>
                  ) : null}
                  <label>
                    <span>按钮文案</span>
                    <Input
                      value={ctaLabel}
                      maxLength={120}
                      placeholder="例如：如何收费？"
                      onChange={(event) => setCtaLabel(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>自动回复</span>
                    <Textarea
                      value={ctaAnswer}
                      maxLength={2000}
                      rows={5}
                      placeholder="客户点击后收到的回复"
                      onChange={(event) => setCtaAnswer(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={
                      saving ||
                      !ctaLabel.trim() ||
                      !ctaAnswer.trim() ||
                      (settings.ctas.length >= CTA_LIMIT && !ctaId)
                    }
                    onClick={saveCta}
                  >
                    {saving ? '保存中…' : '保存 CTA'}
                  </Button>
                </div>
              </MaterialEditorList>
            ) : null}
            {tab === 'attachments' ? (
              <div className="agent-material-attachments">
                <div className="agent-material-attachments-head">
                  <span>
                    <strong>名片与图片</strong>
                    <small>统一作为首次回复附件素材</small>
                  </span>
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onOpenCardSettings}
                    >
                      管理名片
                    </Button>
                    <label className="agent-auto-reply-image-picker">
                      <UiIcon name="image-plus" />
                      <span>{imageUploading ? '上传中…' : '添加图片'}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        disabled={imageUploading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = '';
                          if (file) void uploadImage(file);
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div className="agent-material-attachment-grid">
                  {presets.map((preset) => (
                    <div
                      className="agent-material-attachment-card"
                      key={preset.id}
                    >
                      {preset.kind === 'image' ? (
                        <img
                          src={agentPresetImageUrl(preset.id)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <AgentContactCardIcon
                          id={preset.id}
                          kind={preset.kind}
                          source="preset"
                          hasCustomIcon={preset.hasCustomIcon}
                        />
                      )}
                      <span>
                        <strong>{preset.label}</strong>
                        <small>
                          {preset.kind === 'image'
                            ? preset.originalName || '图片'
                            : `${CONTACT_CARD_LABELS[preset.kind]} · ${preset.value}`}
                        </small>
                      </span>
                      {preset.kind === 'image' ? (
                        <button
                          type="button"
                          aria-label={`删除 ${preset.label}`}
                          disabled={saving}
                          onClick={() => void removeImage(preset)}
                        >
                          <UiIcon name="trash" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {presets.length === 0 ? <p>还没有名片或图片素材。</p> : null}
                </div>
              </div>
            ) : null}
            {error ? <div className="auth-error">{error}</div> : null}
          </div>
        )}
      </section>
    </div>
  );
}

function MaterialEditorList({
  items,
  selectedId,
  onSelect,
  empty,
  children,
}: {
  items: Array<{ id: string; name: string; text: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="agent-material-editor-layout">
      <div className="agent-material-list">
        {items.map((item) => (
          <button
            type="button"
            className={item.id === selectedId ? 'is-selected' : ''}
            key={item.id}
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.name}</strong>
            <small>{item.text}</small>
          </button>
        ))}
        {items.length === 0 ? <p>{empty}</p> : null}
      </div>
      {children}
    </div>
  );
}
