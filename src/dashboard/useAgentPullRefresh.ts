import { useEffect, useRef, useState } from 'react';

const threshold = 64;

// Attach only to the inbox scroller: thread history keeps its own gestures.
export function useAgentPullRefresh(
  enabled: boolean,
  refresh: () => Promise<void>,
) {
  const ref = useRef<HTMLDivElement>(null);
  const refreshing = useRef(false);
  const options = useRef({ enabled, refresh });
  const cancelGesture = useRef<() => void>(() => {});
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<
    'idle' | 'refreshing' | 'success' | 'error'
  >('idle');

  useEffect(() => {
    options.current = { enabled, refresh };
    if (!enabled) cancelGesture.current();
  }, [enabled, refresh]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let active = true;
    let start: { x: number; y: number } | null = null;
    let pulled = 0;
    let claimed = false;
    let suppressClickUntil = 0;
    let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
    const mobile = window.matchMedia('(max-width: 760px)');
    const reset = () => {
      start = null;
      pulled = 0;
      claimed = false;
      setDistance(0);
    };
    cancelGesture.current = reset;
    const startPull = (event: TouchEvent) => {
      reset();
      if (
        !options.current.enabled ||
        !mobile.matches ||
        refreshing.current ||
        event.touches.length !== 1 ||
        element.scrollTop > 0
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return;
      clearTimeout(feedbackTimer);
      setPhase('idle');
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const movePull = (event: TouchEvent) => {
      if (!start) return;
      if (
        event.touches.length !== 1 ||
        !mobile.matches ||
        !options.current.enabled
      ) {
        reset();
        return;
      }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (!claimed) {
        if (dy < -8 || Math.abs(dx) > Math.max(8, Math.abs(dy))) {
          reset();
          return;
        }
        if (dy < 8) return;
        if (element.scrollTop > 0 || !event.cancelable) {
          reset();
          return;
        }
        claimed = true;
      }
      event.preventDefault();
      suppressClickUntil = Date.now() + 500;
      pulled = Math.min(88, Math.max(0, dy * 0.5));
      setDistance(pulled);
    };
    const endPull = () => {
      const shouldRefresh =
        options.current.enabled &&
        mobile.matches &&
        claimed &&
        pulled >= threshold;
      reset();
      if (!shouldRefresh || refreshing.current) return;
      refreshing.current = true;
      setPhase('refreshing');
      void (async () => {
        try {
          await options.current.refresh();
          if (active) setPhase('success');
        } catch {
          if (active) setPhase('error');
        } finally {
          refreshing.current = false;
          if (active) feedbackTimer = setTimeout(() => setPhase('idle'), 2200);
        }
      })();
    };
    const cancelPull = () => reset();
    const cancelClick = (event: MouseEvent) => {
      if (Date.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    element.addEventListener('touchstart', startPull, { passive: true });
    element.addEventListener('touchmove', movePull, { passive: false });
    element.addEventListener('touchend', endPull);
    element.addEventListener('touchcancel', cancelPull);
    element.addEventListener('click', cancelClick, true);
    return () => {
      active = false;
      clearTimeout(feedbackTimer);
      element.removeEventListener('touchstart', startPull);
      element.removeEventListener('touchmove', movePull);
      element.removeEventListener('touchend', endPull);
      element.removeEventListener('touchcancel', cancelPull);
      element.removeEventListener('click', cancelClick, true);
    };
  }, []);

  return {
    ref,
    height: enabled ? (phase === 'idle' ? distance : 44) : 0,
    phase,
    label:
      phase === 'refreshing'
        ? '正在刷新…'
        : phase === 'success'
          ? '已刷新'
          : phase === 'error'
            ? '刷新失败，请下拉重试'
            : distance >= threshold
              ? '松开刷新'
              : '下拉刷新',
  };
}
