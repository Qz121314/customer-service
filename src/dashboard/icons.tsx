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
  ContactRound,
  Download,
  ExternalLink,
  Globe2,
  Headphones,
  ImagePlus,
  LayoutDashboard,
  Link,
  LogOut,
  MessageCircle,
  MessageSquareReply,
  MessageSquareText,
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
  | 'dashboard'
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
  | 'contact'
  | 'plus'
  | 'phone'
  | 'link'
  | 'channel-sms'
  | 'channel-whatsapp'
  | 'channel-telegram'
  | 'channel-website'
  | 'edit'
  | 'trash';

const ICONS: Record<UiIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
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
  contact: ContactRound,
  plus: Plus,
  phone: Phone,
  link: Link,
  'channel-sms': MessageSquareText,
  'channel-whatsapp': MessageCircle,
  'channel-telegram': Send,
  'channel-website': Globe2,
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
