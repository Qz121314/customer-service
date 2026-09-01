import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Headphones,
  ImagePlus,
  Link,
  LogOut,
  MessageSquareReply,
  Pencil,
  Phone,
  Plus,
  Search,
  Send,
  Settings,
  Trash2,
  UserRound,
  Users,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react';

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
  | 'user'
  | 'plus'
  | 'phone'
  | 'link'
  | 'edit'
  | 'trash';

const ICONS: Record<UiIconName, LucideIcon> = {
  agents: Users,
  statistics: ChartNoAxesColumnIncreasing,
  workspace: Headphones,
  external: ExternalLink,
  logout: LogOut,
  notification: Bell,
  sound: Volume2,
  settings: Settings,
  install: Download,
  back: ArrowLeft,
  chevron: ChevronRight,
  'chevron-left': ChevronLeft,
  'auto-reply': MessageSquareReply,
  search: Search,
  calendar: CalendarDays,
  close: X,
  'image-plus': ImagePlus,
  send: Send,
  clock: Clock,
  check: Check,
  'check-double': CheckCheck,
  user: UserRound,
  plus: Plus,
  phone: Phone,
  link: Link,
  edit: Pencil,
  trash: Trash2,
};

export function UiIcon({
  name,
  className = '',
}: {
  name: UiIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  return (
    <Icon
      className={`ui-icon${className ? ` ${className}` : ''}`}
      strokeWidth={1.9}
      aria-hidden="true"
      focusable="false"
    />
  );
}
