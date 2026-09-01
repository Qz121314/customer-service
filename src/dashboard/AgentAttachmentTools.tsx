import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  createAgentAttachmentPreset,
  deleteAgentAttachmentPreset,
  deleteAgentContactCardIcon,
  getAgentAttachmentPresets,
  updateAgentAttachmentPreset,
  uploadAgentContactCardIcon,
  type AgentAttachmentPreset,
  type AgentContactCardKind,
} from './agent-attachments-client';
import { AgentContactCardIcon } from './AgentContactCardIcon';
import { UiIcon } from './icons';
import { Button, Input, Textarea } from './ui';

type ContactCardPreset = Extract<
  AgentAttachmentPreset,
  { kind: AgentContactCardKind }
>;

const CONTACT_CARD_CHANNELS: Array<{
  kind: AgentContactCardKind;
  label: string;
}> = [
  { kind: 'sms', label: 'SMS' },
  { kind: 'whatsapp', label: 'WhatsApp' },
  { kind: 'telegram', label: 'Telegram' },
  { kind: 'website', label: '网站' },
];

const CONTACT_CARD_LABELS: Record<AgentContactCardKind, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  website: '网站',
};

export function AgentComposerAttachmentMenu({
  disabled,
  onSendImage,
  onSendPreset,
}: {
  disabled: boolean;
  onSendImage: (file: File) => void;
  onSendPreset: (preset: ContactCardPreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<AgentAttachmentPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPresets(await getAgentAttachmentPresets());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法加载快捷附件');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        rootRef.current &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
  }, [disabled]);

  const cards = presets.filter(isContactCardPreset);

  const choosePreset = (preset: ContactCardPreset) => {
    setOpen(false);
    onSendPreset(preset);
  };

  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = '';
    setOpen(false);
    if (file) onSendImage(file);
  };

  return (
    <div className="composer-attachment-root" ref={rootRef}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={`composer-attachment-trigger${open ? ' is-open' : ''}`}
        aria-label="添加附件"
        aria-expanded={open}
        disabled={disabled}
        onClick={() =>
          setOpen((current) => {
            if (!current) void refresh();
            return !current;
          })
        }
      >
        <UiIcon name="plus" />
      </Button>

      {open ? (
        <div className="composer-attachment-menu" role="menu">
          <label className="composer-attachment-menu-item is-image">
            <UiIcon name="image-plus" />
            <span>
              <strong>发送图片</strong>
              <small>从当前设备选择图片</small>
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={chooseImage}
            />
          </label>

          {cards.length > 0 ? (
            <div className="composer-attachment-section">
              <span>名片</span>
              {cards.map((preset) => (
                <button
                  type="button"
                  role="menuitem"
                  key={preset.id}
                  onClick={() => choosePreset(preset)}
                >
                  <AgentContactCardIcon
                    id={preset.id}
                    kind={preset.kind}
                    source="preset"
                    hasCustomIcon={preset.hasCustomIcon}
                  />
                  <span>
                    <strong>{preset.label}</strong>
                    <small>
                      {CONTACT_CARD_LABELS[preset.kind]} · {preset.value}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {!loading && cards.length === 0 ? (
            <p className="composer-attachment-empty">
              还没有可用名片，请先在设置中添加渠道名片。
            </p>
          ) : null}
          {loading ? (
            <p className="composer-attachment-empty">正在加载…</p>
          ) : null}
          {error ? <p className="composer-attachment-error">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function AgentCardSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<AgentAttachmentPreset[]>([]);
  const [kind, setKind] = useState<AgentContactCardKind>('sms');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [presetMessage, setPresetMessage] = useState('');
  const [iconFile, setIconFile] = useState<File | null>(null);
  const [removeIconRequested, setRemoveIconRequested] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPresets([]);
    setLoading(true);
    setError('');
    void getAgentAttachmentPresets()
      .then(setPresets)
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : '无法加载名片');
      })
      .finally(() => setLoading(false));
  }, [open]);

  const editablePresets = useMemo(
    () => presets.filter(isContactCardPreset),
    [presets],
  );
  const editingPreset = useMemo(
    () => editablePresets.find((preset) => preset.id === editingId) ?? null,
    [editablePresets, editingId],
  );
  const iconPreviewUrl = useMemo(
    () => (iconFile ? URL.createObjectURL(iconFile) : null),
    [iconFile],
  );

  useEffect(
    () => () => {
      if (iconPreviewUrl) URL.revokeObjectURL(iconPreviewUrl);
    },
    [iconPreviewUrl],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open, saving]);

  if (!open) return null;

  const resetForm = () => {
    setEditingId(null);
    setKind('sms');
    setLabel('');
    setValue('');
    setPresetMessage('');
    setIconFile(null);
    setRemoveIconRequested(false);
    setError('');
  };

  const edit = (preset: ContactCardPreset) => {
    setEditingId(preset.id);
    setKind(preset.kind);
    setLabel(preset.label);
    setValue(preset.value);
    setPresetMessage(preset.presetMessage ?? '');
    setIconFile(null);
    setRemoveIconRequested(false);
    setError('');
  };

  const save = async () => {
    if (!label.trim() || !value.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      const normalizedPresetMessage =
        kind === 'website' ? null : presetMessage.trim() || null;
      let preset = editingId
        ? await updateAgentAttachmentPreset(editingId, {
            label: label.trim(),
            value: value.trim(),
            presetMessage: normalizedPresetMessage,
          })
        : await createAgentAttachmentPreset({
            kind,
            label: label.trim(),
            value: value.trim(),
            presetMessage: normalizedPresetMessage,
          });

      if (!editingId) setEditingId(preset.id);

      if (preset.kind !== 'image') {
        if (iconFile) {
          await uploadAgentContactCardIcon(preset.id, iconFile);
          preset = { ...preset, hasCustomIcon: true };
        } else if (removeIconRequested) {
          await deleteAgentContactCardIcon(preset.id);
          preset = { ...preset, hasCustomIcon: false };
        }
      }

      setPresets((current) => {
        const exists = current.some((item) => item.id === preset.id);
        return exists
          ? current.map((item) => (item.id === preset.id ? preset : item))
          : [...current, preset];
      });
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败');
      void getAgentAttachmentPresets()
        .then(setPresets)
        .catch(() => undefined);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (preset: ContactCardPreset) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await deleteAgentAttachmentPreset(preset.id);
      setPresets((current) => current.filter((item) => item.id !== preset.id));
      if (editingId === preset.id) resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const currentHasCustomIcon = Boolean(
    iconFile || (editingPreset?.hasCustomIcon && !removeIconRequested),
  );
  const field = contactCardField(kind);

  return (
    <div
      className="agent-attachment-manager-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="agent-attachment-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-attachment-manager-title"
      >
        <header>
          <div>
            <span className="eyebrow">坐席设置</span>
            <h2 id="agent-attachment-manager-title">名片</h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="关闭名片设置"
            disabled={saving}
            onClick={onClose}
          >
            <UiIcon name="close" />
          </Button>
        </header>

        <div className="agent-attachment-manager-body">
          <div className="agent-attachment-preset-list">
            {loading ? (
              <p>正在读取名片…</p>
            ) : editablePresets.length === 0 ? (
              <p>
                还没有名片。可添加任意数量的 SMS、WhatsApp、Telegram
                或网站名片。
              </p>
            ) : (
              editablePresets.map((preset) => (
                <div className="agent-attachment-preset-row" key={preset.id}>
                  <AgentContactCardIcon
                    id={preset.id}
                    kind={preset.kind}
                    source="preset"
                    hasCustomIcon={preset.hasCustomIcon}
                  />
                  <span>
                    <strong>{preset.label}</strong>
                    <small>
                      {CONTACT_CARD_LABELS[preset.kind]} · {preset.value}
                    </small>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`编辑 ${preset.label}`}
                    disabled={saving}
                    onClick={() => edit(preset)}
                  >
                    <UiIcon name="edit" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`删除 ${preset.label}`}
                    disabled={saving}
                    onClick={() => void remove(preset)}
                  >
                    <UiIcon name="trash" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="agent-attachment-editor">
            <div className="agent-attachment-kind-tabs" role="tablist">
              {CONTACT_CARD_CHANNELS.map((channel) => (
                <button
                  type="button"
                  key={channel.kind}
                  className={kind === channel.kind ? 'is-active' : ''}
                  disabled={loading || Boolean(editingId)}
                  onClick={() => {
                    setKind(channel.kind);
                    if (channel.kind === 'website') setPresetMessage('');
                  }}
                >
                  <AgentContactCardIcon
                    id={`channel-${channel.kind}`}
                    kind={channel.kind}
                    source="preset"
                    hasCustomIcon={false}
                  />
                  {channel.label}
                </button>
              ))}
            </div>

            <div className="agent-card-icon-editor">
              <span>图标</span>
              <div className="agent-card-icon-control">
                <AgentContactCardIcon
                  id={editingPreset?.id ?? 'new-card'}
                  kind={kind}
                  source="preset"
                  hasCustomIcon={currentHasCustomIcon}
                  previewUrl={iconPreviewUrl}
                />
                <span>
                  <strong>
                    {iconFile
                      ? iconFile.name
                      : currentHasCustomIcon
                        ? '自定义图标'
                        : `${CONTACT_CARD_LABELS[kind]} 内置图标`}
                  </strong>
                  <small>
                    默认使用标准渠道图标；可上传 PNG / JPG / WebP，最大 256 KB
                  </small>
                </span>
                <div className="agent-card-icon-actions">
                  <label className="agent-card-icon-picker">
                    {currentHasCustomIcon ? '更换图标' : '上传自定义图标'}
                    <input
                      aria-label="名片图标"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={loading || saving}
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        event.currentTarget.value = '';
                        if (!file) return;
                        setIconFile(file);
                        setRemoveIconRequested(false);
                      }}
                    />
                  </label>
                  {currentHasCustomIcon ? (
                    <button
                      type="button"
                      className="agent-card-icon-remove"
                      disabled={loading || saving}
                      onClick={() => {
                        setIconFile(null);
                        setRemoveIconRequested(
                          Boolean(editingPreset?.hasCustomIcon),
                        );
                      }}
                    >
                      恢复内置图标
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <label>
              <span>名称</span>
              <Input
                value={label}
                maxLength={80}
                disabled={loading || saving}
                placeholder={`例如：${CONTACT_CARD_LABELS[kind]} 联系`}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label>
              <span>{field.label}</span>
              <Input
                aria-label={field.ariaLabel}
                value={value}
                maxLength={2048}
                disabled={loading || saving}
                inputMode={field.inputMode}
                placeholder={field.placeholder}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            {kind !== 'website' ? (
              <label>
                <span>预设话术（可选）</span>
                <Textarea
                  value={presetMessage}
                  maxLength={2000}
                  rows={3}
                  disabled={loading || saving}
                  placeholder="访客点击后预填到输入框，由访客自行发送"
                  onChange={(event) => setPresetMessage(event.target.value)}
                />
              </label>
            ) : null}
            {error ? <div className="auth-error">{error}</div> : null}
            <div className="agent-attachment-editor-actions">
              {editingId ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving}
                  onClick={resetForm}
                >
                  取消编辑
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={loading || saving || !label.trim() || !value.trim()}
                onClick={() => void save()}
              >
                {saving ? '保存中…' : editingId ? '保存修改' : '添加'}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function isContactCardPreset(
  preset: AgentAttachmentPreset,
): preset is ContactCardPreset {
  return preset.kind !== 'image';
}

function contactCardField(kind: AgentContactCardKind): {
  label: string;
  ariaLabel: string;
  placeholder: string;
  inputMode: 'tel' | 'text' | 'url';
} {
  switch (kind) {
    case 'sms':
      return {
        label: '短信号码',
        ariaLabel: '短信号码',
        placeholder: '+1 213 555 1234',
        inputMode: 'tel',
      };
    case 'whatsapp':
      return {
        label: 'WhatsApp 号码',
        ariaLabel: 'WhatsApp 号码',
        placeholder: '+1 213 555 1234',
        inputMode: 'tel',
      };
    case 'telegram':
      return {
        label: 'Telegram 用户名',
        ariaLabel: 'Telegram 用户名',
        placeholder: '@support_team',
        inputMode: 'text',
      };
    case 'website':
      return {
        label: '网站 URL',
        ariaLabel: '网站 URL',
        placeholder: 'https://example.com/contact',
        inputMode: 'url',
      };
  }
}
