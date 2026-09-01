import { useEffect, useState } from 'react';
import {
  agentAttachmentCardIconUrl,
  agentPresetCardIconUrl,
  type AgentContactCardKind,
} from './agent-attachments-client';
import { UiIcon, type UiIconName } from './icons';

const CHANNEL_ICONS: Record<AgentContactCardKind, UiIconName> = {
  sms: 'channel-sms',
  whatsapp: 'channel-whatsapp',
  telegram: 'channel-telegram',
  website: 'channel-website',
};

export function AgentContactCardIcon({
  id,
  kind,
  source,
  hasCustomIcon,
  previewUrl = null,
}: {
  id: string;
  kind: AgentContactCardKind;
  source: 'preset' | 'message';
  hasCustomIcon?: boolean;
  previewUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [hasCustomIcon, id, kind, previewUrl, source]);

  const iconUrl = previewUrl
    ? previewUrl
    : source === 'preset'
      ? agentPresetCardIconUrl(id)
      : agentAttachmentCardIconUrl(id);
  const shouldLoadCustom = Boolean(previewUrl || (hasCustomIcon && !failed));

  return (
    <span
      className="agent-contact-card-icon"
      data-channel={kind}
      aria-hidden="true"
    >
      <UiIcon name={CHANNEL_ICONS[kind]} />
      {shouldLoadCustom ? (
        <img
          src={iconUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
