import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) => `${index + 1}月`);
const PANEL_WIDTH = 296;
const VIEWPORT_GUTTER = 12;
const POPOVER_GAP = 8;
const CHAT_TIME_ZONE = 'America/Los_Angeles';

type PopoverPosition = {
  left: number;
  top: number;
};

export function MonthPicker({
  value,
  onChange,
  label = '统计月份',
  tone = 'light',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  tone?: 'light' | 'dark';
}) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => parseMonth(value).year);
  const [position, setPosition] = useState<PopoverPosition>({
    left: 0,
    top: 0,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = parseMonth(value);
  const current = parseMonth(currentBusinessMonth());

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerRect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 278;
    const maxLeft = Math.max(
      VIEWPORT_GUTTER,
      window.innerWidth - PANEL_WIDTH - VIEWPORT_GUTTER,
    );
    const left = Math.min(
      maxLeft,
      Math.max(VIEWPORT_GUTTER, triggerRect.right - PANEL_WIDTH),
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
  }, [open, placePopover, viewYear]);

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
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
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

  const toggle = () => {
    setOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      if (nextOpen) setViewYear(selected.year);
      return nextOpen;
    });
  };

  const chooseMonth = (year: number, month: number) => {
    onChange(`${year}-${String(month).padStart(2, '0')}`);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const picker = open ? (
    <div
      ref={panelRef}
      className="month-picker-popover"
      role="dialog"
      aria-label="选择统计月份"
      style={{ left: position.left, top: position.top }}
    >
      <div className="month-picker-popover-head">
        <button
          type="button"
          aria-label="上一年"
          onClick={() => setViewYear((year) => year - 1)}
        >
          <Chevron direction="left" />
        </button>
        <div>
          <span>选择年份</span>
          <strong>{viewYear}</strong>
        </div>
        <button
          type="button"
          aria-label="下一年"
          onClick={() => setViewYear((year) => year + 1)}
        >
          <Chevron direction="right" />
        </button>
      </div>
      <div className="month-picker-grid" role="grid">
        {MONTH_LABELS.map((monthLabel, index) => {
          const month = index + 1;
          const isSelected =
            selected.year === viewYear && selected.month === month;
          const isCurrent =
            current.year === viewYear && current.month === month;
          return (
            <button
              key={monthLabel}
              type="button"
              className={`${isSelected ? 'is-selected' : ''}${
                isCurrent ? ' is-current' : ''
              }`}
              aria-pressed={isSelected}
              onClick={() => chooseMonth(viewYear, month)}
            >
              {monthLabel}
              {isCurrent && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="month-picker-popover-foot">
        <span>按自然月统计</span>
        <button
          type="button"
          onClick={() => chooseMonth(current.year, current.month)}
        >
          返回本月
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className={`month-picker is-${tone}`}>
      <button
        ref={triggerRef}
        type="button"
        className="month-picker-trigger"
        aria-label={`选择统计月份，当前 ${formatMonth(value)}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span>{label}</span>
        <strong>{formatMonth(value)}</strong>
        <CalendarIcon />
      </button>
      {picker && createPortal(picker, document.body)}
    </div>
  );
}

function parseMonth(value: string): { year: number; month: number } {
  const [year, month] = value.split('-').map(Number);
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    month: Number.isFinite(month) ? month : 1,
  };
}

function formatMonth(value: string): string {
  const parsed = parseMonth(value);
  return `${parsed.year}年${String(parsed.month).padStart(2, '0')}月`;
}

function currentBusinessMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}`;
}

function Chevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={direction === 'left' ? 'm9.5 4-4 4 4 4' : 'm6.5 4 4 4-4 4'}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M5.25 2.75v2M12.75 2.75v2M3.25 7h11.5M4.5 4h9A1.5 1.5 0 0 1 15 5.5v8A1.5 1.5 0 0 1 13.5 15h-9A1.5 1.5 0 0 1 3 13.5v-8A1.5 1.5 0 0 1 4.5 4Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}
