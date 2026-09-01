import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { UiIcon } from './icons';
import {
  currentReportingDate,
  reportingRetentionStart,
} from './traffic-statistics-range';

const PANEL_WIDTH = 332;
const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

type DateRange = { from: string; to: string };
type PopoverPosition = { left: number; top: number };

export function TrafficDateRangePicker({
  value,
  onApply,
}: {
  value: DateRange | null;
  onApply: (from: string, to: string) => void;
}) {
  const today = currentReportingDate();
  const minDate = reportingRetentionStart(today);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() =>
    (value?.to ?? today).slice(0, 7),
  );
  const [draftFrom, setDraftFrom] = useState(value?.from ?? today);
  const [draftTo, setDraftTo] = useState(value?.to ?? today);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [position, setPosition] = useState<PopoverPosition>({
    left: 0,
    top: 0,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelWidth = Math.min(
      PANEL_WIDTH,
      window.innerWidth - VIEWPORT_GUTTER * 2,
    );
    const panelHeight = panelRef.current?.offsetHeight ?? 420;
    const maxLeft = Math.max(
      VIEWPORT_GUTTER,
      window.innerWidth - panelWidth - VIEWPORT_GUTTER,
    );
    const left = Math.min(
      maxLeft,
      Math.max(VIEWPORT_GUTTER, triggerRect.right - panelWidth),
    );
    const below = triggerRect.bottom + POPOVER_GAP;
    const top =
      below + panelHeight <= window.innerHeight - VIEWPORT_GUTTER
        ? below
        : Math.max(
            VIEWPORT_GUTTER,
            triggerRect.top - panelHeight - POPOVER_GAP,
          );
    setPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
    const frame = window.requestAnimationFrame(placePopover);
    return () => window.cancelAnimationFrame(frame);
  }, [open, placePopover, viewMonth]);

  useEffect(() => {
    if (!open) return;
    const closeForOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeForOutsidePress);
    document.addEventListener('keydown', closeForEscape, true);
    window.addEventListener('resize', placePopover, { passive: true });
    window.addEventListener('scroll', placePopover, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener('pointerdown', closeForOutsidePress);
      document.removeEventListener('keydown', closeForEscape, true);
      window.removeEventListener('resize', placePopover);
      window.removeEventListener('scroll', placePopover, true);
    };
  }, [open, placePopover]);

  function toggle() {
    setOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      if (nextOpen) {
        const nextFrom = value?.from ?? today;
        const nextTo = value?.to ?? today;
        setDraftFrom(nextFrom);
        setDraftTo(nextTo);
        setAnchorDate(null);
        setViewMonth(nextTo.slice(0, 7));
      }
      return nextOpen;
    });
  }

  function chooseDate(date: string) {
    if (date < minDate || date > today) return;
    if (!anchorDate) {
      setDraftFrom(date);
      setDraftTo(date);
      setAnchorDate(date);
      return;
    }
    setDraftFrom(date < anchorDate ? date : anchorDate);
    setDraftTo(date < anchorDate ? anchorDate : date);
    setAnchorDate(null);
  }

  function apply() {
    onApply(draftFrom, draftTo);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const monthDays = calendarDays(viewMonth);
  const previous = shiftMonth(viewMonth, -1);
  const next = shiftMonth(viewMonth, 1);
  const canGoPrevious = previous >= minDate.slice(0, 7);
  const canGoNext = next <= today.slice(0, 7);

  const picker = open ? (
    <div
      ref={panelRef}
      className="traffic-date-picker-popover"
      role="dialog"
      aria-label="选择流量统计日期"
      style={{ left: position.left, top: position.top }}
    >
      <div className="traffic-date-picker-head">
        <button
          type="button"
          aria-label="上个月"
          disabled={!canGoPrevious}
          onClick={() => setViewMonth(previous)}
        >
          <UiIcon name="chevron-left" />
        </button>
        <div>
          <span>自定义统计日期</span>
          <strong>{formatMonth(viewMonth)}</strong>
        </div>
        <button
          type="button"
          aria-label="下个月"
          disabled={!canGoNext}
          onClick={() => setViewMonth(next)}
        >
          <UiIcon name="chevron" />
        </button>
      </div>

      <div className="traffic-date-picker-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="traffic-date-picker-grid" role="grid">
        {monthDays.map((date, index) => {
          if (!date) {
            return <span key={`empty-${index}`} aria-hidden="true" />;
          }
          const disabled = date < minDate || date > today;
          const selectedStart = date === draftFrom;
          const selectedEnd = date === draftTo;
          const inRange = date >= draftFrom && date <= draftTo;
          const isToday = date === today;
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              className={`${inRange ? 'is-in-range' : ''}${
                selectedStart ? ' is-range-start' : ''
              }${selectedEnd ? ' is-range-end' : ''}${
                isToday ? ' is-today' : ''
              }`}
              aria-label={formatFullDate(date)}
              aria-pressed={selectedStart || selectedEnd}
              onClick={() => chooseDate(date)}
            >
              {Number(date.slice(8, 10))}
            </button>
          );
        })}
      </div>

      <div className="traffic-date-picker-selection">
        <div>
          <span>{anchorDate ? '请选择结束日期' : '当前区间'}</span>
          <strong>{formatRange(draftFrom, draftTo)}</strong>
        </div>
        <small>可查询最近 90 天，未来日期不可选</small>
      </div>

      <div className="traffic-date-picker-actions">
        <button
          type="button"
          className="is-secondary"
          onClick={() => {
            setDraftFrom(today);
            setDraftTo(today);
            setAnchorDate(null);
            setViewMonth(today.slice(0, 7));
          }}
        >
          今天
        </button>
        <div>
          <button
            type="button"
            className="is-secondary"
            onClick={() => setOpen(false)}
          >
            取消
          </button>
          <button type="button" className="is-primary" onClick={apply}>
            应用
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`traffic-date-picker-trigger${value ? ' is-active' : ''}`}
        aria-label={
          value
            ? `自定义统计日期，当前 ${formatRange(value.from, value.to)}`
            : '自定义统计日期'
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <UiIcon name="calendar" />
        <span>自定义</span>
      </button>
      {picker && createPortal(picker, document.body)}
    </>
  );
}

function calendarDays(month: string): Array<string | null> {
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const leading = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const result: Array<string | null> = Array.from(
    { length: leading },
    () => null,
  );
  for (let day = 1; day <= daysInMonth; day += 1) {
    result.push(
      `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    );
  }
  return result;
}

function shiftMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(value: string): string {
  const [year, month] = value.split('-');
  return `${year}年${month}月`;
}

function formatRange(from: string, to: string): string {
  if (from === to) return formatFullDate(from);
  return `${formatShortDate(from)} — ${formatShortDate(to)}`;
}

function formatFullDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function formatShortDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}
