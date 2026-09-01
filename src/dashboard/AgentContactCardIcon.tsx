import { useEffect, useState } from 'react';
import {
  agentAttachmentCardIconUrl,
  agentPresetCardIconUrl,
  type AgentContactCardKind,
} from './agent-attachments-client';

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
      <BuiltInChannelIcon kind={kind} />
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

function BuiltInChannelIcon({ kind }: { kind: AgentContactCardKind }) {
  if (kind === 'whatsapp') {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          fill="currentColor"
          d="M12.04 2a9.84 9.84 0 0 0-8.45 14.89L2 22l5.24-1.54A9.96 9.96 0 1 0 12.04 2Zm0 17.99a8.1 8.1 0 0 1-4.13-1.13l-.3-.18-3.11.91.93-3.03-.2-.31a7.86 7.86 0 0 1-1.22-4.22 8.03 8.03 0 1 1 8.03 7.96Zm4.42-6.02c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06-.24-.12-1.02-.37-1.94-1.19a7.3 7.3 0 0 1-1.34-1.67c-.14-.24-.01-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.19-.47-.39-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.12 3.63.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.43-.59 1.63-1.15.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z"
        />
      </svg>
    );
  }

  if (kind === 'telegram') {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          fill="currentColor"
          d="M21.7 3.3 18.6 20c-.23 1.18-.84 1.47-1.7.92l-4.72-3.48-2.28 2.2c-.25.25-.46.46-.95.46l.34-4.8 8.74-7.9c.38-.34-.08-.53-.59-.19L6.64 14.02 1.98 12.56c-1.01-.32-1.03-1.01.21-1.5L20.4 4.04c.84-.31 1.58.19 1.3 1.26Z"
        />
      </svg>
    );
  }

  if (kind === 'website') {
    return (
      <svg viewBox="0 0 24 24" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.9" />
        <path d="M3.5 12h17M12 3c2.2 2.45 3.3 5.45 3.3 9S14.2 18.55 12 21M12 3C9.8 5.45 8.7 8.45 8.7 12S9.8 18.55 12 21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 5.5h16v10H8l-4 3v-13Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M7.5 9h9M7.5 12h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
