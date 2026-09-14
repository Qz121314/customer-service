import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import {
  getAgentAttachmentPresets,
  type AgentAttachmentPreset,
  type AgentContactCardKind,
} from './agent-attachments-client';
import { AgentContactCardIcon } from './AgentContactCardIcon';
import { UiIcon } from './icons';
import { Button } from './ui';

type ContactCardPreset = Extract<
  AgentAttachmentPreset,
  { kind: AgentContactCardKind }
>;

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

function isContactCardPreset(
  preset: AgentAttachmentPreset,
): preset is ContactCardPreset {
  return preset.kind !== 'image';
}
