import type { ReactNode } from 'react';

export type UiIconName =
  | 'agents'
  | 'statistics'
  | 'workspace'
  | 'external'
  | 'logout'
  | 'notification'
  | 'sound'
  | 'settings'
  | 'install'
  | 'back'
  | 'chevron'
  | 'chevron-left'
  | 'auto-reply'
  | 'search'
  | 'calendar'
  | 'close'
  | 'image-plus'
  | 'send'
  | 'clock'
  | 'check'
  | 'check-double'
  | 'transfer'
  | 'user'
  | 'plus';

const iconPaths: Record<UiIconName, ReactNode> = {
  agents: (
    <>
      <path d="M15.5 20v-1.7a4.3 4.3 0 0 0-4.3-4.3H6.8a4.3 4.3 0 0 0-4.3 4.3V20" />
      <circle cx="9" cy="7" r="4" />
      <path d="M16.5 3.3a4 4 0 0 1 0 7.4M21.5 20v-1.7a4.3 4.3 0 0 0-3.2-4.15" />
    </>
  ),
  statistics: (
    <>
      <path d="M4 20V10M10 20V5M16 20v-7M22 20V3" />
      <path d="M2 20h22" />
    </>
  ),
  workspace: (
    <>
      <path d="M4 13a8 8 0 0 1 16 0" />
      <path d="M18 19c0 1.1-.9 2-2 2h-3" />
      <path d="M4 13v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2ZM20 13v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z" />
    </>
  ),
  external: (
    <>
      <path d="M15 4h5v5M11 13 20 4" />
      <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
    </>
  ),
  logout: (
    <>
      <path d="m15 16 4-4-4-4M19 12H8" />
      <path d="M11 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6" />
    </>
  ),
  notification: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  sound: (
    <>
      <path d="m11 5-5 4H3v6h3l5 4Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  install: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M5 20h14" />
    </>
  ),
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'auto-reply': (
    <>
      <path d="M20 15a4 4 0 0 1-4 4H8l-5 3v-14a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4" />
      <path d="m14 10 3-3 3 3M17 7v8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  calendar: (
    <>
      <path d="M7 2v3M17 2v3M3 9h18" />
      <rect x="3" y="4" width="18" height="17" rx="2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  'image-plus': (
    <>
      <rect x="3" y="6" width="14" height="14" rx="2" />
      <path d="m3 16 4-4 4 4 2-2 4 4M20 3v6M17 6h6" />
    </>
  ),
  send: (
    <>
      <path d="m4 4 17 8-17 8 3.7-8L4 4Z" />
      <path d="M8 12h13" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  'check-double': (
    <>
      <path d="m3 12 4 4L17 6" />
      <path d="m11 15 2 2 8-9" />
    </>
  ),
  transfer: (
    <>
      <path d="M7 7h12l-3-3M19 7l-3 3" />
      <path d="M17 17H5l3 3M5 17l3-3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export function UiIcon({
  name,
  className = '',
}: {
  name: UiIconName;
  className?: string;
}) {
  return (
    <svg
      className={`ui-icon${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {iconPaths[name]}
    </svg>
  );
}
