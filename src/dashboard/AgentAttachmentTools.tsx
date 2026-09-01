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
} from './agent-attachments-client';
import { AgentContactCardIcon } from './AgentContactCardIcon';
import { UiIcon } from './icons';
import { Button, Input } from './ui';

type ContactCardPreset = Extract<
  AgentAttachmentPreset,
  { kind: 'phone' | 'link' }
>;

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

  const cards = presets.filter(
    (preset): preset is ContactCardPreset =>
      preset.kind === 'phone' || preset.kind === 'link',
  );

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
                    source="preset"
                    hasCustomIcon={preset.hasCustomIcon}
                  />
                  <span>
                    <strong>{preset.label}</strong>
                    <small>
                      {preset.kind === 'phone' ? 'SMS' : '链接'} · {preset.value}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {!loading && cards.length === 0 ? (
            <p className="composer-attachment-empty">
              还没有可用名片，请先在设置中添加 SMS 或链接名片。
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
  const [kind, setKind] = useState<'phone' | 'link'>('phone');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
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
    () =>
      presets.filter(
        (preset): preset is ContactCardPreset =>
          preset.kind === 'phone' || preset.kind === 'link',
      ),
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
    setKind('phone');
    setLabel('');
    setValue('');
    setIconFile(null);
    setRemoveIconRequested(false);
    setError('');
  };

  const edit = (preset: ContactCardPreset) => {
    setEditingId(preset.id);
    setKind(preset.kind);
    setLabel(preset.label);
    setValue(preset.value);
    setIconFile(null);
    setRemoveIconRequested(false);
    setError('');
  };

  const save = async () => {
    if (!label.trim() || !value.trim() || saving) return;
    setSaving(true);
    setError('');
    try {
      let preset = editingId
        ? await updateAgentAttachmentPreset(editingId, {
            label: label.trim(),
            value: value.trim(),
          })
        : await createAgentAttachmentPreset({
            kind,
            label: label.trim(),
            value: value.trim(),
          });

      if (!editingId) setEditingId(preset.id);

      if (preset.kind === 'phone' || preset.kind === 'link') {
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
      void getAgentAttachmentPresets().then(setPresets).catch(() => undefined);
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
              <p>还没有名片。可添加任意数量的 SMS 或链接名片。</p>
            ) : (
              editablePresets.map((preset) => (
                <div className="agent-attachment-preset-row" key={preset.id}>
                  <AgentContactCardIcon
                    id={preset.id}
                    source="preset"
                    hasCustomIcon={preset.hasCustomIcon}
                  />
                  <span>
                    <strong>{preset.label}</strong>
                    <small>
                      {preset.kind === 'phone' ? 'SMS' : '链接'} · {preset.value}
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
              <button
                type="button"
                className={kind === 'phone' ? 'is-active' : ''}
                disabled={loading || Boolean(editingId)}
                onClick={() => setKind('phone')}
              >
                <UiIcon name="contact" />
                SMS
              </button>
              <button
                type="button"
                className={kind === 'link' ? 'is-active' : ''}
                disabled={loading || Boolean(editingId)}
                onClick={() => setKind('link')}
              >
                <UiIcon name="link" />
                链接
              </button>
            </div>

            <div className="agent-card-icon-editor">
              <span>图标</span>
              <div className="agent-card-icon-control">
                <AgentContactCardIcon
                  id={editingPreset?.id ?? 'new-card'}
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
                        : '默认名片图标'}
                  </strong>
                  <small>PNG / JPG / WebP，最大 256 KB</small>
                </span>
                <div className="agent-card-icon-actions">
                  <label className="agent-card-icon-picker">
                    {currentHasCustomIcon ? '更换图标' : '上传图标'}
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
                        setRemoveIconRequested(Boolean(editingPreset?.hasCustomIcon));
                      }}
                    >
                      移除
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
                placeholder={
                  kind === 'phone' ? '例如：短信联系' : '例如：付款链接'
                }
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label>
              <span>{kind === 'phone' ? '短信号码' : 'URL'}</span>
              <Input
                value={value}
                maxLength={2048}
                disabled={loading || saving}
                inputMode={kind === 'phone' ? 'tel' : 'url'}
                placeholder={
                  kind === 'phone'
                    ? '+1 213 555 1234'
                    : 'https://example.com/path'
                }
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
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
