import { useEffect, useState } from 'react';
import {
  agentAttachmentCardIconUrl,
  agentPresetCardIconUrl,
  type AgentContactCardKind,
} from './agent-attachments-client';
import { UiIcon } from './icons';

const CHANNEL_BRANDS: Record<AgentContactCardKind, string> = {
  sms: 'imessage',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  website: 'website',
};

const CHANNEL_BRAND_ICON_URLS = {
  sms: '/icons/contact-card-imessage.svg',
  whatsapp: '/icons/contact-card-whatsapp.svg',
  telegram: '/icons/contact-card-telegram.svg',
} as const;

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
      data-brand={CHANNEL_BRANDS[kind]}
      aria-hidden="true"
    >
      <BuiltInContactCardIcon kind={kind} />
      {shouldLoadCustom ? (
        <img
          className="agent-contact-card-custom-icon"
          src={iconUrl}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function BuiltInContactCardIcon({ kind }: { kind: AgentContactCardKind }) {
  if (kind === 'website') return <UiIcon name="channel-website" />;
  return (
    <img
      className="channel-brand-icon"
      src={CHANNEL_BRAND_ICON_URLS[kind]}
      alt=""
      draggable="false"
    />
  );
}
