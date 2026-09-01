import { useEffect, useState } from 'react';
import {
  agentAttachmentCardIconUrl,
  agentPresetCardIconUrl,
} from './agent-attachments-client';
import { UiIcon } from './icons';

export function AgentContactCardIcon({
  id,
  source,
  hasCustomIcon,
  previewUrl = null,
}: {
  id: string;
  source: 'preset' | 'message';
  hasCustomIcon?: boolean;
  previewUrl?: string | null;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [hasCustomIcon, id, previewUrl, source]);

  const iconUrl = previewUrl
    ? previewUrl
    : source === 'preset'
      ? agentPresetCardIconUrl(id)
      : agentAttachmentCardIconUrl(id);
  const shouldLoad =
    Boolean(previewUrl) || (hasCustomIcon !== false && !failed);

  return (
    <span className="agent-contact-card-icon" aria-hidden="true">
      <UiIcon name="contact" />
      {shouldLoad ? (
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
