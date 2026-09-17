import { useEffect, useMemo, useState } from 'react';
import {
  getAgentFirstReplySettings,
  updateAgentFirstReplySettings,
  type AgentFirstReplyItem,
  type AgentFirstReplyItemType,
  type AgentFirstReplyProfile,
  type AgentFirstReplySettings,
} from './agent-auto-reply-client';
import {
  agentPresetImageUrl,
  createAgentAttachmentPreset,
  deleteAgentAttachmentPreset,
  getAgentAttachmentPresets,
  updateAgentAttachmentPreset,
  uploadAgentContactCardIcon,
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
  items: [],
};
const EMPTY_SETTINGS: AgentFirstReplySettings = {
  enabled: false,
  activeProfileId: null,
  greetings: [],
  ctas: [],
  profiles: [EMPTY_PROFILE],
};
const CTA_LIMIT = 10;
const PROFILE_LIMIT = 20;
const CONTACT_CARD_LABELS: Record<AgentContactCardKind, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: '网站',
};
const FIRST_REPLY_ITEM_LABELS: Record<AgentFirstReplyItemType, string> = {
  greeting: '问候语',
  cta: 'CTA',
  contact_card: '名片',
  image: '图片',
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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [addContentOpen, setAddContentOpen] = useState(false);
  const [addContentType, setAddContentType] =
    useState<AgentFirstReplyItemType>('greeting');
  const [addMaterialId, setAddMaterialId] = useState('');

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
  const changed = JSON.stringify(settings) !== JSON.stringify(saved);
  const activeContent = Boolean(selectedProfile?.items.length);
  const canSave =
    !loading &&
    !saving &&
    changed &&
    settings.profiles.length > 0 &&
    settings.profiles.every((profile) => profile.name.trim()) &&
    (!settings.enabled || activeContent);

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
      const next = await updateAgentFirstReplySettings({
        ...settings,
        activeProfileId: selectedProfile?.id ?? null,
        ctas: settings.ctas.map((item) => ({
          ...item,
          label: item.label.trim(),
          answer: item.answer.trim(),
        })),
        profiles: settings.profiles.map(({ id, name, items }) => ({
          id,
          name: name.trim(),
          items,
        })),
      });
      setSettings(next);
      setSaved(next);
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
      items: [],
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

  const getMaterialOptions = (type: AgentFirstReplyItemType) => {
    if (type === 'greeting') {
      return settings.greetings.map((item) => ({
        id: item.id,
        label: item.name,
      }));
    }
    if (type === 'cta') {
      return settings.ctas.map((item) => ({ id: item.id, label: item.label }));
    }
    return presets
      .filter((item) =>
        type === 'image' ? item.kind === 'image' : item.kind !== 'image',
      )
      .map((item) => ({
        id: item.id,
        label:
          item.kind === 'image'
            ? item.label
            : item.label.trim().toLowerCase() ===
                CONTACT_CARD_LABELS[item.kind].toLowerCase()
              ? item.label
              : `${CONTACT_CARD_LABELS[item.kind]} · ${item.label}`,
      }));
  };
  const addMaterialOptions = getMaterialOptions(addContentType);

  const openAddContent = () => {
    setAddContentType('greeting');
    setAddMaterialId(getMaterialOptions('greeting')[0]?.id ?? '');
    setAddContentOpen(true);
  };

  const addContentItem = () => {
    if (!addMaterialId) return;
    updateSelectedProfile((profile) => ({
      ...profile,
      items: [
        ...profile.items,
        {
          id: crypto.randomUUID(),
          type: addContentType,
          materialId: addMaterialId,
          sortOrder: profile.items.length,
        },
      ],
    }));
    setAddContentOpen(false);
  };

  const removeContentItem = (itemId: string) => {
    updateSelectedProfile((profile) => ({
      ...profile,
      items: profile.items
        .filter((item) => item.id !== itemId)
        .map((item, index) => ({ ...item, sortOrder: index })),
    }));
  };

  const moveContentItem = (index: number, direction: -1 | 1) => {
    updateSelectedProfile((profile) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= profile.items.length) return profile;
      const items = [...profile.items];
      [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
      return {
        ...profile,
        items: items.map((item, itemIndex) => ({
          ...item,
          sortOrder: itemIndex,
        })),
      };
    });
  };

  const materialLabel = (item: AgentFirstReplyItem) => {
    if (item.type === 'greeting') {
      return (
        settings.greetings.find((material) => material.id === item.materialId)
          ?.name ?? item.materialId
      );
    }
    if (item.type === 'cta') {
      return (
        settings.ctas.find((material) => material.id === item.materialId)
          ?.label ?? item.materialId
      );
    }
    const preset = presets.find((material) => material.id === item.materialId);
    return preset
      ? preset.kind === 'image'
        ? preset.label
        : `${CONTACT_CARD_LABELS[preset.kind]} · ${preset.label}`
      : item.materialId;
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
        className="agent-auto-reply-dialog agent-first-reply-dialog agent-dialog-surface"
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
                        {profile.items.length} 个内容项 ·{' '}
                        {
                          profile.items.filter(
                            (item) => item.type === 'greeting',
                          ).length
                        }{' '}
                        个问候语
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
                  <div className="agent-first-reply-choice-head">
                    <div>
                      <strong>方案内容</strong>
                      <small>
                        按访客看到的顺序排列，可重复添加同一类型素材
                      </small>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="添加方案内容"
                      onClick={openAddContent}
                    >
                      <UiIcon name="plus" />
                    </Button>
                  </div>
                  {selectedProfile.items.length ? (
                    <ol className="agent-first-reply-content-list">
                      {selectedProfile.items.map((item, index) => (
                        <li key={item.id}>
                          <span className="agent-first-reply-content-index">
                            {index + 1}
                          </span>
                          <span className="agent-first-reply-content-copy">
                            <strong>
                              {FIRST_REPLY_ITEM_LABELS[item.type]}
                            </strong>
                            <small>{materialLabel(item)}</small>
                          </span>
                          <span className="agent-first-reply-content-actions">
                            <button
                              type="button"
                              className="agent-first-reply-order-button"
                              aria-label={`上移第 ${index + 1} 个内容项`}
                              disabled={index === 0}
                              onClick={() => moveContentItem(index, -1)}
                            >
                              <UiIcon name="chevron" />
                            </button>
                            <button
                              type="button"
                              className="agent-first-reply-order-button is-down"
                              aria-label={`下移第 ${index + 1} 个内容项`}
                              disabled={
                                index === selectedProfile.items.length - 1
                              }
                              onClick={() => moveContentItem(index, 1)}
                            >
                              <UiIcon name="chevron" />
                            </button>
                            <button
                              type="button"
                              className="agent-first-reply-remove-button"
                              aria-label={`删除第 ${index + 1} 个内容项`}
                              onClick={() => removeContentItem(item.id)}
                            >
                              <UiIcon name="close" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="agent-first-reply-content-empty">
                      还没有内容项，点击右上角加号添加素材。
                    </div>
                  )}
                  {addContentOpen ? (
                    <div
                      className="agent-first-reply-content-dialog"
                      role="dialog"
                      aria-label="添加方案内容"
                    >
                      <div className="agent-first-reply-content-dialog-head">
                        <strong>添加内容</strong>
                        <button
                          type="button"
                          aria-label="关闭添加内容"
                          onClick={() => setAddContentOpen(false)}
                        >
                          <UiIcon name="close" />
                        </button>
                      </div>
                      <label>
                        <span>类型</span>
                        <select
                          value={addContentType}
                          onChange={(event) => {
                            const nextType = event.target
                              .value as AgentFirstReplyItemType;
                            setAddContentType(nextType);
                            setAddMaterialId(
                              getMaterialOptions(nextType)[0]?.id ?? '',
                            );
                          }}
                        >
                          {Object.entries(FIRST_REPLY_ITEM_LABELS).map(
                            ([type, label]) => (
                              <option key={type} value={type}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        <span>素材</span>
                        <select
                          value={addMaterialId}
                          disabled={!addMaterialOptions.length}
                          onChange={(event) =>
                            setAddMaterialId(event.target.value)
                          }
                        >
                          {addMaterialOptions.length ? (
                            addMaterialOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))
                          ) : (
                            <option value="">暂无可用素材</option>
                          )}
                        </select>
                      </label>
                      <Button
                        type="button"
                        disabled={!addMaterialId}
                        onClick={addContentItem}
                      >
                        添加到方案
                      </Button>
                    </div>
                  ) : null}
                </section>
                {settings.enabled && !activeContent ? (
                  <div className="auth-error">
                    开启后至少添加一个可发送的问候语、名片或图片。
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

function SectionHead({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="agent-first-reply-section-head">
      <span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

type MaterialTab = 'greetings' | 'ctas' | 'cards' | 'images';

export function AgentMaterialsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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
  const [cardEditingId, setCardEditingId] = useState<string | null>(null);
  const [cardKind, setCardKind] = useState<AgentContactCardKind>('sms');
  const [cardLabel, setCardLabel] = useState('');
  const [cardValue, setCardValue] = useState('');
  const [cardPresetMessage, setCardPresetMessage] = useState('');
  const [cardIconFile, setCardIconFile] = useState<File | null>(null);
  const [cardHasCustomIcon, setCardHasCustomIcon] = useState(false);
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
    setCardEditingId(null);
    setCardKind('sms');
    setCardLabel('');
    setCardValue('');
    setCardPresetMessage('');
    setCardIconFile(null);
    setCardHasCustomIcon(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  const cardPresets = useMemo(
    () => presets.filter((item) => item.kind !== 'image'),
    [presets],
  );
  const imagePresets = useMemo(
    () => presets.filter((item) => item.kind === 'image'),
    [presets],
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
      const value = await updateAgentFirstReplySettings({
        ...next,
        profiles: next.profiles.map(({ id, name, items }) => ({
          id,
          name,
          items,
        })),
      });
      setSettings(value);
      setSaved(value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '素材保存失败');
    } finally {
      setSaving(false);
    }
  };

  const resetGreetingEditor = () => {
    setGreetingId(null);
    setGreetingName('');
    setGreetingText('');
  };
  const resetCtaEditor = () => {
    setCtaId(null);
    setCtaLabel('');
    setCtaAnswer('');
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
    const profiles = settings.profiles.map((profile) => ({
      ...profile,
      items: profile.items
        .filter((item) => !(item.type === 'greeting' && item.materialId === id))
        .map((item, index) => ({ ...item, sortOrder: index })),
    }));
    const activeProfile = settings.profiles.find(
      (profile) => profile.id === settings.activeProfileId,
    );
    const activeHasAttachment = Boolean(
      activeProfile?.items.some(
        (item) =>
          (item.type === 'contact_card' || item.type === 'image') &&
          presets.some((preset) => preset.id === item.materialId),
      ),
    );
    const disableAutomation =
      settings.enabled &&
      activeProfile?.items.some(
        (item) => item.type === 'greeting' && item.materialId === id,
      ) &&
      !activeHasAttachment;
    void saveMaterials({
      ...settings,
      enabled: disableAutomation ? false : settings.enabled,
      greetings,
      profiles,
    });
    if (greetingId === id) resetGreetingEditor();
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
      items: profile.items
        .filter((item) => !(item.type === 'cta' && item.materialId === id))
        .map((item, index) => ({ ...item, sortOrder: index })),
    }));
    void saveMaterials({ ...settings, ctas, profiles });
    if (ctaId === id) resetCtaEditor();
  };
  const replaceImage = async (file: File, current: AgentAttachmentPreset) => {
    setImageUploading(true);
    setError('');
    try {
      const replacement = await uploadAgentAttachmentImage(
        file,
        file.name || '素材图片',
      );
      await deleteAgentAttachmentPreset(current.id);
      setPresets((items) =>
        items.map((item) => (item.id === current.id ? replacement : item)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片替换失败');
    } finally {
      setImageUploading(false);
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
          items: profile.items
            .filter(
              (item) =>
                !(
                  (item.type === 'contact_card' || item.type === 'image') &&
                  item.materialId === preset.id
                ),
            )
            .map((item, index) => ({ ...item, sortOrder: index })),
        })),
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图片删除失败');
    } finally {
      setSaving(false);
    }
  };

  const resetCardEditor = () => {
    setCardEditingId(null);
    setCardKind('sms');
    setCardLabel('');
    setCardValue('');
    setCardPresetMessage('');
    setCardIconFile(null);
    setCardHasCustomIcon(false);
  };
  const startNewCard = () => {
    resetCardEditor();
  };
  const editCard = (
    preset: Extract<AgentAttachmentPreset, { kind: AgentContactCardKind }>,
  ) => {
    setCardEditingId(preset.id);
    setCardKind(preset.kind);
    setCardLabel(preset.label);
    setCardValue(preset.value);
    setCardPresetMessage(preset.presetMessage ?? '');
    setCardIconFile(null);
    setCardHasCustomIcon(preset.hasCustomIcon);
  };
  const saveCard = async () => {
    const label = cardLabel.trim();
    const value = cardValue.trim();
    if (!label || !value || saving) return;
    setSaving(true);
    setError('');
    try {
      let preset = (
        cardEditingId
          ? await updateAgentAttachmentPreset(cardEditingId, {
              label,
              value,
              presetMessage:
                cardKind === 'website'
                  ? null
                  : cardPresetMessage.trim() || null,
            })
          : await createAgentAttachmentPreset({
              kind: cardKind,
              label,
              value,
              presetMessage:
                cardKind === 'website'
                  ? null
                  : cardPresetMessage.trim() || null,
            })
      ) as Extract<AgentAttachmentPreset, { kind: AgentContactCardKind }>;
      if (cardIconFile) {
        await uploadAgentContactCardIcon(preset.id, cardIconFile);
        preset = { ...preset, hasCustomIcon: true };
      } else {
        preset = { ...preset, hasCustomIcon: cardHasCustomIcon };
      }
      setPresets((current) => {
        const exists = current.some((item) => item.id === preset.id);
        return exists
          ? current.map((item) => (item.id === preset.id ? preset : item))
          : [...current, preset];
      });
      resetCardEditor();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '名片保存失败');
    } finally {
      setSaving(false);
    }
  };
  const removeCard = async (
    preset: Extract<AgentAttachmentPreset, { kind: AgentContactCardKind }>,
  ) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await deleteAgentAttachmentPreset(preset.id);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
      setSettings((current) => ({
        ...current,
        profiles: current.profiles.map((profile) => ({
          ...profile,
          items: profile.items
            .filter(
              (item) =>
                !(
                  (item.type === 'contact_card' || item.type === 'image') &&
                  item.materialId === preset.id
                ),
            )
            .map((item, index) => ({ ...item, sortOrder: index })),
        })),
      }));
      if (cardEditingId === preset.id) resetCardEditor();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '名片删除失败');
    } finally {
      setSaving(false);
    }
  };
  const cardValueLabel =
    cardKind === 'website'
      ? '网站 URL'
      : cardKind === 'sms'
        ? '短信号码'
        : `${CONTACT_CARD_LABELS[cardKind]} 号码`;

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
        className="agent-auto-reply-dialog agent-materials-dialog agent-dialog-surface"
        role="dialog"
        aria-modal="true"
        aria-label="素材库"
      >
        <header className="agent-auto-reply-head">
          <div>
            <h2>素材</h2>
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
                className={tab === 'cards' ? 'is-active' : ''}
                onClick={() => setTab('cards')}
              >
                名片 <small>{cardPresets.length}</small>
              </button>
              <button
                type="button"
                className={tab === 'images' ? 'is-active' : ''}
                onClick={() => setTab('images')}
              >
                图片 <small>{imagePresets.length}</small>
              </button>
            </nav>
            {tab === 'greetings' ? (
              <MaterialEditorList
                items={settings.greetings}
                selectedId={greetingId}
                onSelect={setGreetingId}
                onDelete={removeGreeting}
                empty="还没有问候语素材。"
              >
                <div className="agent-material-editor">
                  <div className="agent-material-editor-head">
                    <SectionHead title="问候语" />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetGreetingEditor}
                    >
                      新增
                    </Button>
                  </div>
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
                onDelete={removeCta}
                empty="还没有 CTA 素材。"
              >
                <div className="agent-material-editor">
                  <div className="agent-material-editor-head">
                    <SectionHead title="CTA" />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={resetCtaEditor}
                    >
                      新增
                    </Button>
                  </div>
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
            {tab === 'cards' ? (
              <div className="agent-card-workspace">
                <section
                  className="agent-card-library-pane"
                  aria-labelledby="agent-card-library-title"
                >
                  <div className="agent-material-attachments-head">
                    <span>
                      <strong id="agent-card-library-title">已保存名片</strong>
                      <small>客服可直接使用的联系方式</small>
                    </span>
                    <small>{cardPresets.length} 张</small>
                  </div>
                  <div className="agent-material-attachment-grid">
                    {cardPresets.map((preset) => (
                      <div
                        className="agent-material-attachment-card"
                        key={preset.id}
                      >
                        <AgentContactCardIcon
                          id={preset.id}
                          kind={preset.kind}
                          source="preset"
                          hasCustomIcon={preset.hasCustomIcon}
                        />
                        <span>
                          <strong>{preset.label}</strong>
                          <small>{`${CONTACT_CARD_LABELS[preset.kind]} · ${preset.value}`}</small>
                        </span>
                        <span className="agent-material-card-actions">
                          <button
                            type="button"
                            aria-label={`编辑 ${preset.label}`}
                            disabled={saving}
                            onClick={() => editCard(preset)}
                          >
                            <UiIcon name="edit" />
                          </button>
                          <button
                            type="button"
                            aria-label={`删除 ${preset.label}`}
                            disabled={saving}
                            onClick={() => void removeCard(preset)}
                          >
                            <UiIcon name="trash" />
                          </button>
                        </span>
                      </div>
                    ))}
                    {cardPresets.length === 0 ? (
                      <p>还没有名片，右侧填写第一张。</p>
                    ) : null}
                  </div>
                </section>
                <section
                  className="agent-card-editor-pane"
                  aria-labelledby="agent-card-editor-title"
                >
                  <div className="agent-inline-card-editor">
                    <div className="agent-inline-card-editor-head">
                      <span>
                        <strong id="agent-card-editor-title">
                          {cardEditingId ? '编辑名片' : '录入名片'}
                        </strong>
                        <small>
                          填写联系方式，保存后可在首次回复中组合使用
                        </small>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={saving}
                        onClick={startNewCard}
                      >
                        新增
                      </Button>
                    </div>
                    <div className="agent-inline-card-fields">
                      <label>
                        <span>类型</span>
                        <select
                          aria-label="名片类型"
                          value={cardKind}
                          disabled={Boolean(cardEditingId) || saving}
                          onChange={(event) =>
                            setCardKind(
                              event.target.value as AgentContactCardKind,
                            )
                          }
                        >
                          <option value="sms">SMS</option>
                          <option value="whatsapp">WhatsApp</option>
                          <option value="telegram">Telegram</option>
                          <option value="website">网站</option>
                        </select>
                      </label>
                      <label className="agent-inline-card-icon-picker">
                        <span>图标</span>
                        <span className="agent-inline-card-icon-value">
                          <AgentContactCardIcon
                            id={cardEditingId ?? `channel-${cardKind}`}
                            kind={cardKind}
                            source="preset"
                            hasCustomIcon={cardHasCustomIcon}
                          />
                          <span>
                            {cardIconFile?.name ?? '使用渠道默认图标'}
                          </span>
                        </span>
                        <input
                          type="file"
                          aria-label="名片图标"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={saving}
                          onChange={(event) => {
                            setCardIconFile(event.target.files?.[0] ?? null);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <label>
                        <span>名称</span>
                        <Input
                          value={cardLabel}
                          maxLength={80}
                          placeholder="例如：客服短信"
                          onChange={(event) => setCardLabel(event.target.value)}
                        />
                      </label>
                      <label>
                        <span>{cardValueLabel}</span>
                        <Input
                          aria-label={cardValueLabel}
                          value={cardValue}
                          maxLength={2048}
                          placeholder={
                            cardKind === 'website'
                              ? 'https://example.com'
                              : '+1 213 555 1234'
                          }
                          onChange={(event) => setCardValue(event.target.value)}
                        />
                      </label>
                      {cardKind !== 'website' ? (
                        <label className="agent-inline-card-message">
                          <span>预设话术（可选）</span>
                          <Textarea
                            value={cardPresetMessage}
                            maxLength={2000}
                            rows={2}
                            placeholder="访客点击后预填的消息"
                            onChange={(event) =>
                              setCardPresetMessage(event.target.value)
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                    <div className="agent-inline-card-editor-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={saving}
                        onClick={resetCardEditor}
                      >
                        清空
                      </Button>
                      <Button
                        type="button"
                        disabled={
                          saving || !cardLabel.trim() || !cardValue.trim()
                        }
                        onClick={() => void saveCard()}
                      >
                        {saving
                          ? '保存中…'
                          : cardEditingId
                            ? '保存修改'
                            : '保存名片'}
                      </Button>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}
            {tab === 'images' ? (
              <div className="agent-material-attachments">
                <div className="agent-material-attachments-head">
                  <span>
                    <strong>图片</strong>
                    <small>共 {imagePresets.length} 张</small>
                  </span>
                  <label className="agent-auto-reply-image-picker">
                    <UiIcon name="image-plus" />
                    <span>{imageUploading ? '上传中…' : '新增'}</span>
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
                <div className="agent-material-attachment-grid">
                  {imagePresets.map((preset) => (
                    <div
                      className="agent-material-attachment-card"
                      key={preset.id}
                    >
                      <img
                        src={agentPresetImageUrl(preset.id)}
                        alt=""
                        loading="lazy"
                      />
                      <span>
                        <strong>{preset.label}</strong>
                        <small>{preset.originalName || '图片'}</small>
                      </span>
                      <div className="agent-material-card-actions">
                        <label
                          className="agent-material-image-edit"
                          aria-label={`编辑 ${preset.label}`}
                        >
                          <UiIcon name="edit" />
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            disabled={imageUploading}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.currentTarget.value = '';
                              if (file) void replaceImage(file, preset);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          aria-label={`删除 ${preset.label}`}
                          disabled={saving}
                          onClick={() => void removeImage(preset)}
                        >
                          <UiIcon name="trash" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {imagePresets.length === 0 ? (
                    <p>还没有图片，点击上方“添加图片”开始。</p>
                  ) : null}
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
  onDelete,
  empty,
  children,
}: {
  items: Array<{ id: string; name: string; text: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="agent-material-editor-layout">
      <div className="agent-material-list">
        {items.map((item) => (
          <div
            className={
              item.id === selectedId
                ? 'agent-material-card is-selected'
                : 'agent-material-card'
            }
            key={item.id}
          >
            <button type="button" onClick={() => onSelect(item.id)}>
              <strong>{item.name}</strong>
              <small>{item.text}</small>
            </button>
            <div className="agent-material-card-actions">
              <button
                type="button"
                aria-label={'编辑 ' + item.name}
                onClick={() => onSelect(item.id)}
              >
                <UiIcon name="edit" />
              </button>
              <button
                type="button"
                aria-label={'删除 ' + item.name}
                onClick={() => onDelete(item.id)}
              >
                <UiIcon name="trash" />
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 ? <p>{empty}</p> : null}
      </div>
      {children}
    </div>
  );
}
